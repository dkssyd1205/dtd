// script.js

// 1. DOM Element References
const gameBoard = document.getElementById('game-board');
const playerAreasContainer = document.getElementById('player-areas');
const gameInfo = document.getElementById('game-info');
const currentPlayerSpan = document.getElementById('current-player');
const roundPotSpan = document.getElementById('round-pot');
const lastPlayedHandInfoSpan = document.getElementById('last-played-hand-info');

const startGameBtn = document.getElementById('start-game-btn');
const playSelectedBtn = document.getElementById('play-selected-btn');
const passTurnBtn = document.getElementById('pass-turn-btn');
const forfeitRoundBtn = document.getElementById('forfeit-round-btn');

// Helper for suit symbols
const SUIT_SYMBOLS = {
    Sun: 'S',
    Moon: 'M',
    Star: 'St',
    Cloud: 'C'
};

// 2. Tile Rendering Function
/**
 * Creates a DOM element for a tile.
 * @param {object} tileData - The tile data (e.g., { suit: 'Sun', displayRank: '2', rankValue: 17, suitValue: 3, id: "S2" }).
 * @returns {HTMLDivElement} The created tile div element.
 */
function renderTile(tileData) {
    const tileDiv = document.createElement('div');
    tileDiv.classList.add('tile');
    tileDiv.classList.add(`tile-${tileData.suit}`); // e.g., tile-Sun

    // Set inner HTML for display (Suit Symbol <br/> Display Rank)
    const suitSymbol = SUIT_SYMBOLS[tileData.suit] || tileData.suit.charAt(0);
    tileDiv.innerHTML = `${suitSymbol}<br/>${tileData.displayRank}`;

    // Store tile data on the element using dataset attributes
    tileDiv.dataset.suit = tileData.suit;
    tileDiv.dataset.displayRank = tileData.displayRank;
    tileDiv.dataset.rankValue = tileData.rankValue;
    tileDiv.dataset.suitValue = tileData.suitValue;
    if (tileData.id) { // Store unique ID if available
        tileDiv.dataset.id = tileData.id;
    }

    // Add event listener for click to toggle 'selected' class
    tileDiv.addEventListener('click', () => {
        tileDiv.classList.toggle('selected');
        // Potentially update playSelectedBtn state here based on selection
    });

    return tileDiv;
}

// 3. Render Player Hand Function
/**
 * Renders a player's hand of tiles.
 * @param {string|number} playerId - The ID of the player.
 * @param {Array<object>} handArray - An array of tile objects.
 */
function renderPlayerHand(playerId, handArray) {
    const playerHandDiv = document.getElementById(`player-${playerId}-hand`);
    if (!playerHandDiv) {
        console.error(`Player hand area for player ${playerId} not found.`);
        return;
    }

    // Clear any existing tiles
    playerHandDiv.innerHTML = '';

    // Sort hand before rendering (optional, but good for player UX)
    // Assuming compareTiles function is available or will be (for now, render as is)
    // handArray.sort(compareTiles); // Later we'll need compareTiles from server.js or a client-side version

    // Iterate and append tiles
    handArray.forEach(tileData => {
        const tileElement = renderTile(tileData);
        playerHandDiv.appendChild(tileElement);
    });

    // Update tile count display
    const tileCountSpan = document.querySelector(`#player-${playerId}-area .tile-count`);
    if (tileCountSpan) {
        tileCountSpan.textContent = handArray.length;
    }
}

// 4. Placeholder for Fetching Game State
/**
 * Fetches the initial game state from the server.
 * (This will be expanded later to use fetch API)
 */
function fetchInitialGameState() {
    console.log("Fetching initial game state...");
    // Simulate fetching data and setting up the game
    // This would involve:
    // 1. Calling an endpoint on server.js
    // 2. Receiving player hands, current turn, etc.
    // 3. Calling renderPlayerHand for each player
    // 4. Updating gameInfo panel
    // For now, we'll use dummy data or the initial setup in DOMContentLoaded
}

// 5. Event Listener for "Start Game"
startGameBtn.addEventListener('click', () => {
    console.log("Start Game button clicked");
    fetchInitialGameState();

    // Example: Disable start button, enable other controls (will be refined)
    startGameBtn.disabled = true;
    startGameBtn.style.display = 'none'; // Hide start button
    playSelectedBtn.disabled = false;
    passTurnBtn.disabled = false;
    // forfeitRoundBtn.style.display = 'inline-block'; // Show when a round is active

    // Update game info (example)
    if (currentPlayerSpan) currentPlayerSpan.textContent = "Player 1"; // Placeholder
    if (gameInfo.children[0]) gameInfo.children[0].textContent = "Game started! Player 1's turn.";
});

// 6. Initial Call / Setup
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded and parsed");

    // Example: Create a dummy player area for testing hand rendering
    // This structure should ideally be created based on game state from the server
    if (!document.getElementById('player-1-area')) {
        const testPlayerArea = document.createElement('div');
        testPlayerArea.classList.add('player-area');
        testPlayerArea.id = 'player-1-area';
        // Example with score and tile count spans
        testPlayerArea.innerHTML = `<h3>Player 1 (<span class="player-score">0</span> points, <span class="tile-count">0</span> tiles)</h3>
                                  <div class="player-hand" id="player-1-hand"></div>`;
        if (playerAreasContainer) {
            playerAreasContainer.appendChild(testPlayerArea);
        } else {
            console.error("playerAreasContainer not found for dummy player setup.");
            return;
        }
    } else {
        // Ensure player 1 hand div exists if area was pre-defined (e.g. in index.html example)
        if (!document.getElementById('player-1-hand')) {
            const handDiv = document.createElement('div');
            handDiv.classList.add('player-hand');
            handDiv.id = 'player-1-hand';
            document.getElementById('player-1-area').appendChild(handDiv);
        }
    }


    // Dummy tile data (replace with actual data from server later)
    const dummyHand = [
        { suit: 'Sun', displayRank: '2', rankValue: 17, suitValue: 3, id: "S2" },
        { suit: 'Cloud', displayRank: '3', rankValue: 3, suitValue: 0, id: "C3" },
        { suit: 'Moon', displayRank: 'K', rankValue: 13, suitValue: 2, id: "MK" }, // Assuming K is 13
        { suit: 'Star', displayRank: '7', rankValue: 7, suitValue: 1, id: "St7" }
    ];

    // Check if player 1 hand div exists before rendering
    if (document.getElementById('player-1-hand')) {
        renderPlayerHand('1', dummyHand); // Test rendering for player 1
    } else {
        console.error("Player 1 hand div not found for dummy hand rendering.");
    }


    // Example of rendering a tile on the game board
    const testBoardTileData = { suit: 'Cloud', displayRank: '5', rankValue: 5, suitValue: 0, id: "C5" };
    const testBoardTile = renderTile(testBoardTileData);
    // gameBoard.appendChild(testBoardTile); // Uncomment to test board rendering

    // Initial state of buttons
    playSelectedBtn.disabled = true;
    passTurnBtn.disabled = true;
    // forfeitRoundBtn.style.display = 'none'; // Keep hidden until a round starts
});

// (Future additions: functions to handle play, pass, forfeit, update game state from server, etc.)
