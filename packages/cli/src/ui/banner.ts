import { STRINGS } from '../strings.js';

export function printBanner(): void {
  const { title, subtitle } = STRINGS.banner;
  console.log('');
  console.log(`  ${title}`);
  console.log(`  ${subtitle}`);
  console.log('');
}
