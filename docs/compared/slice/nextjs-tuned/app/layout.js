import { currentGuest } from '../lib/slice.js';

export default async function Layout({ children }) {
  const { slice, guest } = await currentGuest();
  const count = slice.cart(guest).count;
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/slice.css" />
      </head>
      <body>
        <header className="site-head">
          <a href="/">{slice.shop.name}</a>
          <nav aria-label="Site">
            <a href="/">Menu</a>
            <a href="/order">Your order{count ? ` (${count})` : ''}</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
