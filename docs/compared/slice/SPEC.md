# The slice: a menu, bag, pickup time, checkout and order page

One slice of an ordering app, built once per framework. Each build is a small app of its
own in `<framework>/`. Every build:

- calls `shared/slice.js`, the app's own backend, with no framework in it (not in
  this copy: `shared/README.md` has its interface)
- serves `shared/slice.css` unchanged
- passes `contract/slice.contract.mjs` before it is measured

What's measured is in `measure/measure.mjs`, with the menu page as the measured page.

## Pages and posts

Every build has these addresses. A post answers with a 303 back to the page,
carrying the message. The form posts can have any address the framework likes;
the contract only follows the forms.

| What | Where | Does |
| --- | --- | --- |
| Menu | `GET /` | The sections and items, with what's left |
| Add | form on the menu | `slice.add`, then the menu with "Added to your order." or the problem |
| Bag | `GET /order` | The lines, total, and the pickup time form |
| Change | forms on the bag | `slice.change` with the new quantity (0 removes) |
| Time | form on the bag | `slice.choose`, then the bag |
| Checkout | `GET /checkout` | The bag's summary and the payment form; with an empty bag or no time, a 303 to `/order` with the problem |
| Place | form on checkout | `slice.place`; on success a 303 to `/orders/<key>`, otherwise back to `/checkout` (or `/order` when `back` says) with the problem |
| Order | `GET /orders/<key>` | The order's steps and lines; someone else's order or an unknown key is a 404 |
| Live | the framework's choice | Pushes what's left to an open menu, and an order's steps to its open order page, without a reload |

## Markup

Text, roles and these class names are the contract. Anything else is up to the
framework.

```
header.site-head
  a "Hickory Hollow Bakehouse" → /
  nav: a "Menu" → /, a "Your order (2)" → /order     (count when the bag has any)
main
  p.notice "Added to your order."   or   p.notice.problem "Sold out."
  -- menu --
  h1 "Order ahead"
  section (each of Bread, Pastry, Coffee)
    h2 section name
    ul.items > li.item[.out when sold out]
      h3 name
      p.meta "$9.00 · loaf · " span.left "5 left" | "Sold out" (nothing when unlimited)
      form (post): hidden item; input number qty, aria-label "How many <name>",
                   min 1 max 24; button "Add" (both disabled when sold out)
  -- bag --
  h1 "Your order"
  section: h2 "In your bag"
    p "Your bag is empty."   or
    ul.lines > li.line: name, "$9.00 each", line total "$18.00",
                        .qty: forms with buttons "−" (qty−1), the qty, "+" (qty+1), "Remove" (0)
    p.total "Total $18.00"
  section: h2 "Pickup time"
    form (post): label "When you’ll come by" select slot
                 options "tomorrow 7:15 am" ("… (full)" and disabled when full)
                 button "Set the time"
    p "Pickup: tomorrow at 7:15 am" when one is set
  a "Check out" → /checkout     (only when the bag has lines and a time is set)
  -- checkout --
  h1 "Check out"
  p.summary "2 items · $18.00 · pickup tomorrow at 7:15 am"
  form (post): hidden checkout (from slice.checkoutKey(), made with the page)
               label "Name" input name; label "Email" input email;
               label "Card number" input card
               button "Place order · $18.00"
  p.meta "Test mode: 4242 4242 4242 4242 pays, 4000 0000 0000 0002 is declined."
  -- order --
  h1 "Order for tomorrow at 7:15 am"
  p "For Sam · $18.00"
  ol.steps > li ("Placed", "Being made", "Ready at the window", "Picked up");
             li.done for each step reached
  ul.lines > li "2 × Country sourdough"
  -- not found --
  h1 "We can’t find that order."   (status 404)
```

Each validation problem is `slice.place`'s own words: "Give a name for the bag.",
"Give an email we can send the receipt to.", "Give a card number (test mode: …)"
and "That card was declined. Try another." The form keeps the name and email the
guest typed when it comes back with a problem only if the framework does that
without extra work; the contract doesn't require it.

Page titles are `<page> · Hickory Hollow Bakehouse`.

## Running a build

```sh
SLICE_CONTROL_PORT=3199 PORT=3101 npm start        # in <framework>/
BASE=http://localhost:3101 CONTROL=3199 node --test contract/
```
