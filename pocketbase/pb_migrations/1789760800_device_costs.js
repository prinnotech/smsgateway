/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2153001328")

  const num = (id, name) => new Field({
    "hidden": false,
    "id": id,
    "max": null,
    "min": null,
    "name": name,
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  })

  // Money currently loaded on this SIM (user-editable).
  collection.fields.add(num("num_dev_balance", "balance"))
  // Cost charged per SMS on this SIM.
  collection.fields.add(num("num_dev_smscost", "sms_cost"))
  // Warn when the balance drops to/below this (0 or empty = no warning).
  collection.fields.add(num("num_dev_lowbal", "low_balance"))
  // Running total spent from this SIM (sum of sent * cost).
  collection.fields.add(num("num_dev_spent", "spent"))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2153001328")
  collection.fields.removeById("num_dev_balance")
  collection.fields.removeById("num_dev_smscost")
  collection.fields.removeById("num_dev_lowbal")
  collection.fields.removeById("num_dev_spent")
  return app.save(collection)
})
