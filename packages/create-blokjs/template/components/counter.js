export default {
  state: { count: 0 },
  methods: {
    increment() { this.count++ },
    decrement() { this.count-- },
  },
  view: ($) => ({
    div: { children: [
      { h2: { text: $.store.app.title } },
      { h1: { text: $.count } },
      { button: { click: 'decrement', text: '-' } },
      { button: { click: 'increment', text: '+' } },
    ] },
  }),
}
