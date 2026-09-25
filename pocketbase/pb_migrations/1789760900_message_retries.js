/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2605467279")

  // How many times this message has been (re)sent. Resend increments this on
  // the SAME record instead of creating a duplicate.
  collection.fields.add(new Field({
    "hidden": false,
    "id": "num_msg_retries",
    "max": null,
    "min": null,
    "name": "retries",
    "onlyInt": true,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2605467279")
  collection.fields.removeById("num_msg_retries")
  return app.save(collection)
})
