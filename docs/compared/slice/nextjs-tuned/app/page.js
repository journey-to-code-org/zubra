import { currentGuest, said } from '../lib/slice.js';
import { Notice } from './notice.js';
import { LiveMenu } from './live-menu.js';
import { add } from './actions.js';

export async function generateMetadata() {
  const { slice } = await currentGuest();
  return { title: `Menu · ${slice.shop.name}` };
}

export default async function MenuPage({ searchParams }) {
  const { slice } = await currentGuest();
  return (
    <>
      <Notice said={said(slice, await searchParams)} />
      <h1>Order ahead</h1>
      <LiveMenu sections={slice.menu()} add={add} />
    </>
  );
}
