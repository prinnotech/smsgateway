import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, PermissionsAndroid } from 'react-native';
import { loadConfig, clearConfig, getFlag, setFlag, getOrCreateDeviceId } from './store';
import SmsGateway from '../modules/sms-gateway/src/SmsGatewayModule';
import { registerDevices } from './api';

export default function HomeScreen({ onDisconnect }) {
  const [config, setConfig] = useState({ host: '', apiKey: '' });
  const [counters, setCounters] = useState({ sent: 0, received: 0, failed: 0 });
  const [sims, setSims] = useState([]);
  const [batteryOk, setBatteryOk] = useState(true);

  // Counters are now owned by the native service (survive app minimize/close).
  function refreshCounters() {
    try { setCounters(SmsGateway.getCounters()); } catch (e) { }
  }

  async function refresh() {
    setConfig(await loadConfig());
    refreshCounters();
  }

  async function loadSims() {
    try {
      // Request both: READ_PHONE_STATE (to read SIM info) and SEND_SMS
      // (to actually send). Both are runtime permissions on Android 6+.
      const perms = [
        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
        PermissionsAndroid.PERMISSIONS.SEND_SMS,
      ];
      // Best-effort auto phone-number detection (Android 13+).
      if (PermissionsAndroid.PERMISSIONS.READ_PHONE_NUMBERS) {
        perms.push(PermissionsAndroid.PERMISSIONS.READ_PHONE_NUMBERS);
      }
      // Notification permission (Android 13+) so the foreground-service
      // notification can show.
      if (PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) {
        perms.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      }
      const result = await PermissionsAndroid.requestMultiple(perms);
      const GRANTED = PermissionsAndroid.RESULTS.GRANTED;

      if (result[PermissionsAndroid.PERMISSIONS.SEND_SMS] !== GRANTED) {
        Alert.alert(
          'SMS permission needed',
          'Without the "Send SMS" permission this phone can receive queued messages but cannot send them. Enable it in Settings → Apps → SMS Gateway → Permissions.'
        );
      }

      if (result[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE] === GRANTED) {
        const list = SmsGateway.getSimInfo();
        setSims(list);
        // Auto-register this phone's SIMs + device model/Android with the panel.
        try {
          let info;
          try { info = SmsGateway.getDeviceInfo(); } catch (e) {}
          await registerDevices(list, info);
        } catch (e) {
          console.warn('registerDevices failed', e?.message);
        }
      }
    } catch (e) { }
  }

  async function setupBackground(cfg) {
    // Start the NATIVE poll loop with the connection config. It keeps running
    // when the app is minimized or the screen is off. device_id lets the server
    // give THIS phone only its own messages when several phones share a key.
    try {
      if (cfg?.host && cfg?.apiKey) {
        const deviceId = await getOrCreateDeviceId();
        SmsGateway.startService(cfg.host, cfg.apiKey, deviceId, 5000);
      }
    } catch (e) { }
    try {
      const ok = SmsGateway.isIgnoringBatteryOptimizations();
      setBatteryOk(ok);
      // Only auto-prompt for the battery exemption ONCE, ever, so Android
      // relaunches don't nag. The on-screen card lets the user enable it later.
      if (!ok) {
        const alreadyAsked = await getFlag('asked_battery');
        if (!alreadyAsked) {
          SmsGateway.requestIgnoreBatteryOptimizations();
          await setFlag('asked_battery', true);
        }
      }
    } catch (e) { }
  }

  useEffect(() => {
    (async () => {
      const cfg = await loadConfig();
      setConfig(cfg);
      await loadSims();
      setupBackground(cfg);
    })();
    // Reflect the native counters in the UI every few seconds.
    refreshCounters();
    const t = setInterval(refreshCounters, 3000);
    return () => clearInterval(t);
  }, []);

  function maskKey(key) {
    if (!key) return '—';
    if (key.length <= 6) return '••••';
    return key.slice(0, 3) + '••••' + key.slice(-3);
  }

  function handleDisconnect() {
    Alert.alert('Disconnect?', 'You will need to scan the QR again to reconnect.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect', style: 'destructive', onPress: async () => {
          try { SmsGateway.stopService(); } catch (e) { }
          await clearConfig();
          onDisconnect();
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.appName}>SMS Gateway</Text>
          <View style={styles.pill}>
            <View style={styles.pillDot} />
            <Text style={styles.pillText}>Connected</Text>
          </View>
        </View>
        <Text style={styles.host} numberOfLines={1}>{config.host}</Text>

        {/* Stats */}
        <View style={styles.stats}>
          <Stat label="Sent" value={counters.sent} color="#2563eb" />
          <Stat label="Received" value={counters.received} color="#16a34a" />
          <Stat label="Failed" value={counters.failed} color="#dc2626" />
        </View>

        {/* Numbers */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Phone numbers</Text>
          <TouchableOpacity onPress={() => { refresh(); loadSims(); }}>
            <Text style={styles.link}>↻ Refresh</Text>
          </TouchableOpacity>
        </View>
        {sims.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.muted}>No SIM info yet — grant phone permission.</Text>
          </View>
        ) : (
          sims.map((s) => (
            <View key={s.subscriptionId} style={styles.simCard}>
              <View style={styles.simBadge}><Text style={styles.simBadgeText}>{s.slot + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.simCarrier}>{s.carrier || 'Unknown carrier'}</Text>
                <Text style={styles.muted}>{s.number || 'Number not available'}</Text>
              </View>
            </View>
          ))
        )}

        {/* Background reliability */}
        {!batteryOk && (
          <TouchableOpacity
            style={styles.warnCard}
            onPress={() => {
              try { SmsGateway.requestIgnoreBatteryOptimizations(); } catch (e) { }
              setTimeout(() => {
                try { setBatteryOk(SmsGateway.isIgnoringBatteryOptimizations()); } catch (e) { }
              }, 800);
            }}
          >
            <Text style={styles.warnTitle}>⚠ Allow background running</Text>
            <Text style={styles.warnText}>
              Disable battery optimization so messages keep sending when the
              screen is off. Tap to fix.
            </Text>
          </TouchableOpacity>
        )}

        {/* Settings */}
        <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Settings</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Host URL</Text>
          <Text style={styles.value} numberOfLines={1}>{config.host || '—'}</Text>
          <View style={styles.divider} />
          <Text style={styles.label}>API key</Text>
          <Text style={styles.value}>{maskKey(config.apiKey)}</Text>
        </View>

        <TouchableOpacity style={styles.dangerBtn} onPress={handleDisconnect}>
          <Text style={styles.dangerBtnText}>Disconnect</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

function Stat({ label, value, color }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const CARD_SHADOW = {
  shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2,
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f2f3f5' },
  container: { padding: 20, paddingTop: 60, paddingBottom: 40 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  appName: { fontSize: 26, fontWeight: '800', color: '#111827', letterSpacing: -0.5 },
  pill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#dcfce7', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  pillDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#16a34a', marginRight: 6 },
  pillText: { color: '#15803d', fontWeight: '700', fontSize: 13 },
  host: { color: '#9ca3af', marginTop: 6, marginBottom: 24, fontSize: 13 },

  stats: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1, alignItems: 'center', backgroundColor: '#fff', paddingVertical: 22, borderRadius: 16, ...CARD_SHADOW },
  statValue: { fontSize: 30, fontWeight: '800' },
  statLabel: { marginTop: 4, color: '#6b7280', fontSize: 13, fontWeight: '500' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 32, marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  link: { color: '#2563eb', fontSize: 14, fontWeight: '600' },

  card: { backgroundColor: '#fff', borderRadius: 16, padding: 18, ...CARD_SHADOW },
  warnCard: { backgroundColor: '#fffbeb', borderRadius: 16, padding: 16, marginTop: 20, borderWidth: 1, borderColor: '#fde68a' },
  warnTitle: { color: '#b45309', fontWeight: '700', fontSize: 15, marginBottom: 4 },
  warnText: { color: '#92714a', fontSize: 13, lineHeight: 18 },
  simCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 10, ...CARD_SHADOW },
  simBadge: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  simBadgeText: { color: '#2563eb', fontWeight: '800', fontSize: 16 },
  simCarrier: { fontSize: 16, fontWeight: '600', color: '#111827' },

  label: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' },
  value: { fontSize: 15, color: '#111827', marginTop: 3 },
  divider: { height: 1, backgroundColor: '#f0f1f3', marginVertical: 14 },
  muted: { color: '#9ca3af', fontSize: 13, marginTop: 2 },

  dangerBtn: { marginTop: 28, padding: 15, borderRadius: 14, backgroundColor: '#fef2f2', alignItems: 'center', borderWidth: 1, borderColor: '#fecaca' },
  dangerBtnText: { color: '#dc2626', fontWeight: '700', fontSize: 15 },
});