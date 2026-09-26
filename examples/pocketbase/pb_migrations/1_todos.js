/// <reference path="../pb_data/types.d.ts" />

// Open rules so the demo works without login. Restrict them for anything real.
migrate((app) => {
  app.save(new Collection({
    type: 'base',
    name: 'todos',
    listRule: '',
    viewRule: '',
    createRule: '',
    updateRule: '',
    deleteRule: '',
    fields: [
      { name: 'title', type: 'text', required: true },
      { name: 'done', type: 'bool' },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ],
  }))
}, (app) => {
  app.delete(app.findCollectionByNameOrId('todos'))
})
