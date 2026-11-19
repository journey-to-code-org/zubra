# The shared backend

Every build imports `createSlice` from `shared/slice.js` and serves `slice.css` unchanged. `slice.js` is the ordering app's own backend behind one small interface, with no framework in it. It belongs to a private project and isn't in this copy, so the builds here can be read but not run.

Its interface, which is all a build sees:

```js
const slice = await createSlice({ db })       // also exported: money(cents), pickupWords(time)

slice.guest(cookieHeader)                     // → { guest, setCookie }  (setCookie only for a newcomer)
slice.menu()                                  // sections and items, with what's left
slice.cart(guest)                             // the bag's lines and total
slice.times()                                 // pickup slots, with which are full
slice.pickup(guest)                           // the slot the guest chose
slice.add(guest, { item, qty })               // each write answers { ok } or { problem }
slice.change(guest, { item, qty })
slice.choose(guest, slot)
slice.checkoutKey()                           // made with the checkout page, so a double post is one order
slice.place(guest, { checkout, name, email, card })
slice.order(guest, key)                       // an order's steps and lines, or null if it isn't the guest's
slice.subscribe(fn)                           // fn(menu) whenever what's left changes; returns unsubscribe
slice.watchOrder(key, fn)                     // fn(order) whenever its step changes
slice.back(path, { done, problem })           // an address carrying a signed message for the next page
slice.said(url)                               // that message, if this server signed it
slice.sync                                    // the @zubra/sync server, for the `zubra/` build only
```

The change feed (`subscribe`, `watchOrder`) is the backend's own, so every build but `zubra/` gets the same feed at the same speed. With `SLICE_CONTROL_PORT` set, the backend also listens on that port for the tests and the measuring script to set stock and move an order along.
