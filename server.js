// server.js

// Define Tile Suits and Ranks

// Suits: Create constants or an enum for Cloud, Star, Moon, Sun.
// Assign them a hierarchy for ranking (e.g., Cloud: 0, Star: 1, Moon: 2, Sun: 3).
const SUITS = {
  CLOUD: { name: 'Cloud', value: 0 },
  STAR: { name: 'Star', value: 1 },
  MOON: { name: 'Moon', value: 2 },
  SUN: { name: 'Sun', value: 3 },
};

// Ranks: Define the numbers on the tiles: 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15.
// Special Ranks: Note that 1 and 2 are ranked higher than 15.
// The internal representation for ranking should be:
// 3 -> 3, ..., 15 -> 15, 1 -> 16, 2 -> 17
const RANKS = {
  THREE: { display: '3', value: 3 },
  FOUR: { display: '4', value: 4 },
  FIVE: { display: '5', value: 5 },
  SIX: { display: '6', value: 6 },
  SEVEN: { display: '7', value: 7 },
  EIGHT: { display: '8', value: 8 },
  NINE: { display: '9', value: 9 },
  TEN: { display: '10', value: 10 },
  ELEVEN: { display: '11', value: 11 },
  TWELVE: { display: '12', value: 12 },
  THIRTEEN: { display: '13', value: 13 },
  FOURTEEN: { display: '14', value: 14 },
  FIFTEEN: { display: '15', value: 15 },
  ONE: { display: '1', value: 16 }, // Special rank
  TWO: { display: '2', value: 17 }, // Special rank
};

// Tile Representation
// Define a way to represent a tile, perhaps as an object or class,
// e.g., { suit: 'Sun', rank: 15, displayRank: '15', rankValue: 15, suitValue: 3 }.
// - suit: The string name of the suit (e.g., "Sun").
// - displayRank: The rank shown on the tile (e.g., "3", "10", "1", "2").
// - rankValue: The internal numeric value for ranking (3-17 as described above).
// - suitValue: The internal numeric value for suit ranking.

/**
 * Represents a tile in the game.
 * @param {object} suit - The suit of the tile (from SUITS).
 * @param {object} rank - The rank of the tile (from RANKS).
 * @returns {object} A tile object.
 */
function createTile(suit, rank) {
  return {
    suit: suit.name,
    displayRank: rank.display,
    rankValue: rank.value,
    suitValue: suit.value,
  };
}

// Create Deck Function
// Implement a function createDeck() that generates all 60 tiles (4 suits * 15 ranks each).
// Each tile object in the deck should have its suit, displayRank, rankValue, and suitValue correctly populated.
// For example, a Sun 2 tile would be: { suit: 'Sun', displayRank: '2', rankValue: 17, suitValue: 3 }.
// A Cloud 3 tile: { suit: 'Cloud', displayRank: '3', rankValue: 3, suitValue: 0 }.

/**
 * Creates a deck of 60 tiles.
 * @returns {Array<object>} An array of tile objects.
 */
function createDeck() {
  const deck = [];
  for (const suitKey in SUITS) {
    const suit = SUITS[suitKey];
    for (const rankKey in RANKS) {
      const rank = RANKS[rankKey];
      deck.push(createTile(suit, rank));
    }
  }
  return deck;
}

// Tile Comparison Function
// Implement a function compareTiles(tileA, tileB) that returns:
// - A negative number if tileA is weaker than tileB.
// - A positive number if tileA is stronger than tileB.
// - Zero if they are identical (this shouldn't happen with unique tiles in a standard deck, but good for completeness).
// The comparison should first use rankValue. If rankValue is the same, then suitValue should be used to determine the stronger tile.

/**
 * Compares two tiles.
 * @param {object} tileA - The first tile.
 * @param {object} tileB - The second tile.
 * @returns {number} A negative number if tileA is weaker, a positive number if tileA is stronger, or zero if they are identical.
 */
function compareTiles(tileA, tileB) {
  if (tileA.rankValue !== tileB.rankValue) {
    return tileA.rankValue - tileB.rankValue;
  } else {
    return tileA.suitValue - tileB.suitValue;
  }
}

// Example Usage (optional, for testing)
// const deck = createDeck();
// console.log(deck);
// console.log('Deck size:', deck.length);

// const tile1 = createTile(SUITS.SUN, RANKS.TWO); // Sun 2
// const tile2 = createTile(SUITS.MOON, RANKS.TWO); // Moon 2
// const tile3 = createTile(SUITS.SUN, RANKS.FIFTEEN); // Sun 15

// console.log('Comparing Sun 2 and Moon 2:', compareTiles(tile1, tile2)); // Should be positive
// console.log('Comparing Moon 2 and Sun 2:', compareTiles(tile2, tile1)); // Should be negative
// console.log('Comparing Sun 2 and Sun 15:', compareTiles(tile1, tile3)); // Should be positive
// console.log('Comparing Sun 15 and Sun 2:', compareTiles(tile3, tile1)); // Should be negative

module.exports = {
  SUITS,
  RANKS,
  createTile,
  createDeck,
  compareTiles,
};
