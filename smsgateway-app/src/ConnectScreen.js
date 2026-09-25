import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView, PermissionsAndroid } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { saveConfig } from './store';
import SmsGateway from '../modules/sms-gateway/src/SmsGatewayModule';
import { registerDevices } from './api';

export default function ConnectScreen({ onConnected }) {
    const [permission, requestPermission] = useCameraPermissions();
    const [scanning, setScanning] = useState(false);
    const [host, setHost] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [connecting, setConnecting] = useState(false);

    function handleScan({ data }) {
        setScanning(false);
        try {
            const parsed = JSON.parse(data);
            if (!parsed.host || !parsed.apiKey) throw new Error('missing fields');
            setHost(parsed.host);
            setApiKey(parsed.apiKey);
            save(parsed.host, parsed.apiKey);
        } catch (e) {
            Alert.alert('Invalid QR', 'This QR code is not a valid connection code.');
        }
    }

    async function save(h, k) {
        if (!h || !k) {
            Alert.alert('Missing info', 'Both the panel URL and the API key are required.');
            return;
        }
        setConnecting(true);
        await saveConfig({ host: h.trim(), apiKey: k.trim() });

        // Immediately tell the panel "here's my phone" — and verify it's actually
        // reachable, so a wrong/unreachable URL doesn't fail silently.
        try {
            let info;
            try { info = SmsGateway.getDeviceInfo(); } catch (e) {}
            let sims = [];
            try {
                const perms = [PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE];
                if (PermissionsAndroid.PERMISSIONS.READ_PHONE_NUMBERS) {
                    perms.push(PermissionsAndroid.PERMISSIONS.READ_PHONE_NUMBERS);
                }
                const res = await PermissionsAndroid.requestMultiple(perms);
                if (res[PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE] === PermissionsAndroid.RESULTS.GRANTED) {
                    sims = SmsGateway.getSimInfo();
                }
            } catch (e) {}
            await registerDevices(sims, info);
            setConnecting(false);
            onConnected();
        } catch (e) {
            setConnecting(false);
            Alert.alert(
                "Couldn't reach the panel",
                `Saved your connection, but the panel at ${h.trim()} didn't respond.\n\n` +
                `Make sure this URL is reachable from THIS phone — not "localhost". Use your computer's network address (e.g. http://192.168.1.50:3001) or a public HTTPS URL.`,
                [
                    { text: 'Fix URL', style: 'cancel' },
                    { text: 'Continue anyway', onPress: onConnected },
                ]
            );
        }
    }

    // ---- Scanner ----
    if (scanning) {
        if (!permission?.granted) {
            return (
                <View style={styles.center}>
                    <Text style={styles.info}>Camera permission is needed to scan.</Text>
                    <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
                        <Text style={styles.primaryBtnText}>Grant camera access</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => setScanning(false)}>
                        <Text style={styles.link}>Cancel</Text>
                    </TouchableOpacity>
                </View>
            );
        }
        return (
            <View style={styles.container}>
                <CameraView
                    style={styles.camera}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                    onBarcodeScanned={handleScan}
                />
                <View style={styles.scanHint}>
                    <Text style={styles.scanHintText}>Point at the QR code in your panel</Text>
                </View>
                <TouchableOpacity style={styles.cancelScan} onPress={() => setScanning(false)}>
                    <Text style={styles.primaryBtnText}>Cancel</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // ---- Connect form ----
    return (
        <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
            <View style={styles.logo}>
                <Text style={styles.logoMark}>✈</Text>
            </View>
            <Text style={styles.title}>SMS Gateway</Text>
            <Text style={styles.subtitle}>Connect this phone to your panel</Text>

            <View style={styles.card}>
                <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={async () => {
                        if (!permission?.granted) await requestPermission();
                        setScanning(true);
                    }}
                >
                    <Text style={styles.primaryBtnText}>Scan QR code</Text>
                </TouchableOpacity>

                <View style={styles.dividerRow}>
                    <View style={styles.divLine} />
                    <Text style={styles.divText}>or enter manually</Text>
                    <View style={styles.divLine} />
                </View>

                <Text style={styles.label}>Panel URL</Text>
                <TextInput
                    style={styles.input}
                    placeholder="https://your-panel.com"
                    placeholderTextColor="#9ca3af"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    value={host}
                    onChangeText={setHost}
                />

                <Text style={[styles.label, { marginTop: 14 }]}>API key</Text>
                <TextInput
                    style={styles.input}
                    placeholder="Paste your API key"
                    placeholderTextColor="#9ca3af"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={apiKey}
                    onChangeText={setApiKey}
                />

                <TouchableOpacity
                    style={[styles.primaryBtn, { marginTop: 20 }, connecting && { opacity: 0.6 }]}
                    onPress={() => save(host, apiKey)}
                    disabled={connecting}
                >
                    <Text style={styles.primaryBtnText}>{connecting ? 'Connecting…' : 'Connect'}</Text>
                </TouchableOpacity>
            </View>

            <Text style={styles.help}>
                Find these in your panel under{'\n'}
                <Text style={styles.helpBold}>API Keys &amp; Devices → Generate QR</Text>
            </Text>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    screen: { flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f2f3f5' },
    center: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#f2f3f5' },

    logo: { alignSelf: 'center', width: 72, height: 72, borderRadius: 20, backgroundColor: '#4f46e5', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    logoMark: { color: '#fff', fontSize: 34, transform: [{ rotate: '-10deg' }] },
    title: { fontSize: 26, fontWeight: '800', color: '#111827', textAlign: 'center', letterSpacing: -0.5 },
    subtitle: { fontSize: 15, color: '#6b7280', textAlign: 'center', marginTop: 4, marginBottom: 28 },

    card: { backgroundColor: '#fff', borderRadius: 20, padding: 20, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },

    primaryBtn: { backgroundColor: '#4f46e5', paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
    primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

    dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
    divLine: { flex: 1, height: 1, backgroundColor: '#e5e7eb' },
    divText: { marginHorizontal: 12, color: '#9ca3af', fontSize: 13 },

    label: { fontSize: 12, fontWeight: '700', color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
    input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827', backgroundColor: '#fff' },

    help: { textAlign: 'center', color: '#9ca3af', fontSize: 13, marginTop: 22, lineHeight: 19 },
    helpBold: { color: '#6b7280', fontWeight: '700' },

    camera: { flex: 1 },
    scanHint: { position: 'absolute', top: 80, alignSelf: 'center', backgroundColor: '#000a', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
    scanHintText: { color: '#fff', fontSize: 14 },
    cancelScan: { position: 'absolute', bottom: 40, alignSelf: 'center', backgroundColor: '#4f46e5', paddingHorizontal: 40, paddingVertical: 14, borderRadius: 14 },

    info: { textAlign: 'center', marginBottom: 16, color: '#444' },
    link: { color: '#4f46e5', textAlign: 'center', marginTop: 16, fontSize: 15, fontWeight: '600' },
});
