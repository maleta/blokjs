import { mount } from '@maleta/blokjs'
import 'virtual:blokjs'

mount('#app', {
  view: ($) => ({ counter: {} }),
})
