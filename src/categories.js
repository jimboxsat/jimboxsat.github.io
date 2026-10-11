export const CATEGORIES = {
  Tops: ['T-shirts', 'Long-sleeve shirts', 'Tank tops', 'Shirts', 'Hoodies', 'Zip-up Hoodies', 'Crewneck', 'Sweatshirts', 'Knitwear', 'Polos', 'Jerseys'],
  Bottoms: ['Jeans', 'Trousers', 'Joggers', 'Sweatpants', 'Shorts', 'Jorts', 'Cargo Shorts', 'Cargo Pants', 'Skirts'],
  Outerwear: ['Jackets', 'Windbreakers', 'Coats', 'Puffer jackets', 'Denim jackets', 'Overshirts'],
  Shoes: ['Sneakers', 'Boots', 'Sandals', 'Slippers', 'Slides', 'Formal shoes'],
  Accessories: ['Hats', 'Beanies', 'Belts', 'Watches', 'Jewelry', 'Sunglasses'],
  Bags: ['Backpacks', 'Shoulder bags', 'Crossbody bags', 'Totes'],
  Sportswear: ['Training tops', 'Leggings', 'Sports shorts', 'Tracksuits'],
  Swimwear: ['Swim shorts', 'Swimsuits', 'Bikinis'],
  Formalwear: ['Suits', 'Blazers', 'Dresses', 'Dress shirts'],
  Other: []
};
export const MAIN_CATEGORIES = Object.keys(CATEGORIES);
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const OCCASIONS = ['Casual', 'Work', 'Formal', 'Sport', 'Evening', 'Travel', 'Beach'];
export const COLORS = {
  Black: '#1d1d1f', White: '#f6f4ef', Grey: '#9a9a9a', Beige: '#d8c7a8', Brown: '#7a5a3c', Navy: '#1f2b4d', Blue: '#3f6fb5',
  Green: '#4f7a54', Olive: '#6b6b3a', Red: '#b83a3a', Pink: '#e3a0b4', Yellow: '#e2c14a', Orange: '#d98139', Purple: '#7a5aa5', Cream: '#efe6d2'
};
export const COLOR_NAMES = Object.keys(COLORS);

// Default role in outfit layout (starting suggestion only)
export function layoutRole(item) {
  const c = item.category, s = (item.subcategory || '').toLowerCase();
  if (c === 'Outerwear') return 'outer';
  if (c === 'Tops' || c === 'Sportswear' && /top|track/.test(s)) return 'top';
  if (c === 'Bottoms' || (c === 'Sportswear' && /legg|short/.test(s)) || (c === 'Swimwear' && /short/.test(s))) return 'bottom';
  if (c === 'Shoes') return 'shoes';
  if (c === 'Bags') return 'bag';
  if (c === 'Accessories') return 'acc';
  if (c === 'Formalwear') return /dress|suit/.test(s) ? 'full' : /blazer/.test(s) ? 'outer' : 'top';
  if (c === 'Swimwear') return 'full';
  return 'misc';
}
