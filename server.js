// --- 기본 설정 및 상수 선언 ---
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const PORT = 3000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;  // MAX_PLAYERS 상수 선언 (6명까지)

// 정적 파일 제공
app.use(express.static('public'));

/* 
타일은 해(빨강), 별(노란색), 달(초록), 구름(파란색) 4종이며,
각 속성마다 1부터 15까지 적혀 있다.
타일 서열(낮은 순): 3,4,5,...,15,1,2  
속성 서열(낮은 순): 구름 < 별 < 달 < 해
*/

// --- 전역 상수 ---
const combinationRank = ['straight', 'flush', 'fullhouse', 'four', 'straight_flush'];
const valueOrder = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 1, 2];
const suitStrength = { "구름": 1, "별": 2, "달": 3, "해": 4 };

// --- 플레이어 수에 따른 사용 타일 범위 ---
// 2명: 1~7 (28장), 3명: 1~9 (36장), 4명: 1~13 (52장), 5명 이상(및 봇전): 1~15 (60장)
// Plan Item 1: Deck Configuration and Dealing
function getDeckConfig(actualPlayerCount) { // Renamed playerCount to actualPlayerCount for clarity
    let maxNum, cardsPerPlayer;

    if (botGameMode) { // Bot games always use MAX_PLAYERS (implicitly 6) rules for deck size and cards per player
        maxNum = 15;    // 1-15 range (60 tiles)
        cardsPerPlayer = 10; // 10 each
    } else { // Non-bot games
        if (actualPlayerCount === 2) { maxNum = 7; cardsPerPlayer = 14; }    // 28 tiles
        else if (actualPlayerCount === 3) { maxNum = 9; cardsPerPlayer = 12; }   // 36 tiles
        else if (actualPlayerCount === 4) { maxNum = 13; cardsPerPlayer = 13; }  // 52 tiles
        else if (actualPlayerCount === 5) { maxNum = 15; cardsPerPlayer = 12; }  // 60 tiles
        else if (actualPlayerCount === 6) { maxNum = 15; cardsPerPlayer = 10; }  // 60 tiles
        else { // Should not happen if player count is managed correctly (MIN_PLAYERS to MAX_PLAYERS)
            console.error("Unsupported player count for deck configuration:", actualPlayerCount);
            maxNum = 15; 
            cardsPerPlayer = 10; // Default to 6 player rules
        }
    }

    const suits = ['해', '별', '달', '구름'];
    const baseDeck = [];
    for (let suit of suits) {
        for (let num = 1; num <= maxNum; num++) {
            baseDeck.push({ suit, value: num });
        }
    }
    
    // 덱의 총 카드 수가 배분할 카드 수보다 적으면 에러 (이론상 발생 안해야 함)
    // Note: In bot games, actualPlayerCount for getDeckConfig might be MAX_PLAYERS,
    // while the loop for dealing in dealTiles uses the count of non-eliminated players.
    // This is fine as deck is configured for the game type, then dealt.
    if (baseDeck.length < cardsPerPlayer * actualPlayerCount && botGameMode) { // Check for bot mode specifically with MAX_PLAYERS
         console.warn(`Potential deck issue for bot game: Deck size ${baseDeck.length}, configured for ${cardsPerPlayer} cards for ${MAX_PLAYERS} players.`);
    } else if (baseDeck.length < cardsPerPlayer * actualPlayerCount && !botGameMode) {
         console.error(`Deck configuration error: Not enough cards (${baseDeck.length}) to deal ${cardsPerPlayer} cards to ${actualPlayerCount} players.`);
    }
    return { deck: baseDeck.sort(() => Math.random() - 0.5), cardsPerPlayer };
}

// Plan Item 1: Deck Configuration and Dealing
function dealTiles(countOfPlayersToReceiveCards) { 
    // Determine the basis for deck configuration: actual number of players if not botmode, or MAX_PLAYERS if botmode
    const deckConfigPlayerCount = botGameMode ? MAX_PLAYERS : countOfPlayersToReceiveCards;
    const { deck: newDeck, cardsPerPlayer } = getDeckConfig(deckConfigPlayerCount);
    deck = newDeck; 

    // dealtHands is for players who will actually receive cards now
    const dealtHandsForActivePlayers = Array(activePlayerCount).fill(null).map(() => []);
    
    for (let i = 0; i < cardsPerPlayer; i++) {
        for (let j = 0; j < activePlayerCount; j++) {
            if (deck.length > 0) {
                 dealtHandsForActivePlayers[j].push(deck.pop());
            } else {
                console.error("Deck ran out of cards during dealing!");
                break; // 더 이상 카드가 없으면 중단
            }
        }
        if (deck.length === 0 && i < cardsPerPlayer -1) break; 
    }
    return dealtHandsForActivePlayers; // 실제 카드를 받은 활성 플레이어들의 손패만 반환
}

// --- 전역 게임 상태 ---
let players = [];         // 인간+봇 플레이어 ID 배열
let sockets = {};         // 각 플레이어의 소켓 또는 AI 객체
let nicknames = {};       // 플레이어별 닉네임
let hands = [];           // 각 플레이어의 손패
let deck = [];            // 사용 덱 (28,36,52,60장)
let turnIndex = 0;
let lastPlayed = null;
let currentComboType = null;
let currentComboLength = 0;
let passCounter = 0;
let scores = {};          // 각 플레이어 점수 (인간은 64점으로 시작)
let started = false;
let botGameMode = false;
let gameOver = false;
let rematchVotes = {};    // 라운드 종료 후 재시작 투표 (인간만)
let gameStartVotes = {};  // 게임 시작 투표 (인간만)
let finalGameVotes = {};  // 최종 게임 투표 (인간만 참여)
let eliminatedPlayers = {}; // 탈락한 플레이어 관리

// --- 초기 점수 설정 ---
function initializeScores() {
  players.forEach(id => {
    scores[id] = 64; // 모든 플레이어(봇 포함) 64점으로 시작
    eliminatedPlayers[id] = false; // 초기에는 아무도 탈락하지 않음
  });
}

// --- 조합 관련 함수 ---
function getCombinations(arr, k) {
  const results = [];
  function helper(start, combo) {
    if (combo.length === k) {
      results.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      helper(i + 1, combo);
      combo.pop();
    }
  }
  helper(0, []);
  return results;
}

function getAllCombinations(hand, type) {
  let combos = [];
  if (type === 'single') {
    combos = hand.map(card => [card]);
  } else if (type === 'pair') {
    const pairs = getCombinations(hand, 2);
    combos = pairs.filter(pair => pair[0].value === pair[1].value);
  } else if (type === 'triple') {
    const triples = getCombinations(hand, 3);
    combos = triples.filter(triple => triple.every(card => card.value === triple[0].value));
  } else { // 5장 족보
    const fiveCardCombos = getCombinations(hand, 5);
    combos = fiveCardCombos.filter(combo => getComboType(combo) === type);
  }
  return combos;
}

// 카드 강도 계산
// 숫자 강도는 valueOrder.indexOf(card.value) (인덱스가 클수록 강함)
// 같을 경우 속성 점수(suitStrength)
function cardStrength(card) {
  if (!card || typeof card.value === 'undefined' || typeof card.suit === 'undefined') {
    console.error("Invalid card object in cardStrength:", card);
    return 0; // Return a default low strength for invalid cards
  }
  const valueIdx = valueOrder.indexOf(card.value);
  if (valueIdx === -1) {
    console.error("Invalid card value in cardStrength:", card.value);
    return 0; 
  }
  return valueIdx * 10 + suitStrength[card.suit];
}

// Plan Item 11: Card Combination and Strength Logic
// 카드 조합 종류 판별
function getComboType(cards) {
  if (!cards || cards.length === 0) return null;
  cards.sort((a, b) => valueOrder.indexOf(a.value) - valueOrder.indexOf(b.value)); // 서열대로 정렬

  if (cards.length === 1) return 'single';
  if (cards.length === 2 && cards[0].value === cards[1].value) return 'pair';
  if (cards.length === 3 && cards.every(c => c.value === cards[0].value)) return 'triple';

  if (cards.length === 5) {
    const isFlush = cards.every(c => c.suit === cards[0].suit);
    
    let isStraight = true;
    for (let i = 0; i < cards.length - 1; i++) {
      if (valueOrder.indexOf(cards[i+1].value) !== valueOrder.indexOf(cards[i].value) + 1) {
        isStraight = false;
        break;
      }
    }
    // 10-J-Q-K-A (13-14-15-1-2) 스트레이트 (valueOrder: 13,14,15,1,2)
    // 이 경우는 위 로직에서 isStraight=true로 나옴.
    // A-2-3-4-5 (1-2-3-4-5) 스트레이트 (valueOrder: 1,2,3,4,5)
    // 이 경우도 위 로직에서 isStraight=true로 나옴.

    const counts = {};
    cards.forEach(c => { counts[c.value] = (counts[c.value] || 0) + 1; });
    const vals = Object.values(counts).sort((a, b) => b - a);

    if (isStraight && isFlush) return 'straight_flush';
    if (vals[0] === 4) return 'four'; 
    if (vals[0] === 3 && vals[1] === 2) return 'fullhouse';
    if (isFlush) return 'flush';
    if (isStraight) return 'straight';
  }
  return null; 
}

// Plan Item 11: Card Combination and Strength Logic
// isStronger 수정: 족보 우선, 그 다음 가장 높은 카드의 서열 비교
function isStronger(newCards, oldCards) {
  const newType = getComboType(newCards);
  const oldType = getComboType(oldCards);

  // 다른 종류의 조합이거나, 이전 조합이 없으면(선 플레이어) 항상 가능 (단, play 핸들러에서 타입체크는 선행)
  if (!oldType) return true; 

  // 5장 조합 대결
  if (newCards.length === 5 && oldCards.length === 5) {
    const newRank = combinationRank.indexOf(newType);
    const oldRank = combinationRank.indexOf(oldType);
    if (newRank !== oldRank) return newRank > oldRank;

    // 같은 5장 족보일 때
    // newCards와 oldCards는 getComboType 내부에서 이미 valueOrder로 정렬되어 있음
    // 혹은 여기서 다시 정렬
    const sortedNew = [...newCards].sort((a,b) => cardStrength(b) - cardStrength(a)); // 가장 강한 카드 순 정렬
    const sortedOld = [...oldCards].sort((a,b) => cardStrength(b) - cardStrength(a));

    if (newType === 'fullhouse') {
        // 풀하우스: 3장의 카드 숫자로 비교
        const newThreeValue = sortedNew.find(c => sortedNew.filter(c2 => c2.value === c.value).length === 3).value;
        const oldThreeValue = sortedOld.find(c => sortedOld.filter(c2 => c2.value === c.value).length === 3).value;
        // 숫자가 같을 수 없음 (카드 한 벌 사용) - 단, 다른 속성의 같은 숫자 가능. 여기선 valueOrder로 비교.
        const newThreeCardForStrength = sortedNew.find(c=>c.value === newThreeValue); // 3장 중 아무거나
        const oldThreeCardForStrength = sortedOld.find(c=>c.value === oldThreeValue);
        // valueOrder 인덱스로 비교해야 함
        return valueOrder.indexOf(newThreeCardForStrength.value) > valueOrder.indexOf(oldThreeCardForStrength.value);
    } else if (newType === 'four') {
        // 포카드: 4장의 카드 숫자로 비교
        const newFourValue = sortedNew.find(c => sortedNew.filter(c2 => c2.value === c.value).length === 4).value;
        const oldFourValue = sortedOld.find(c => sortedOld.filter(c2 => c2.value === c.value).length === 4).value;
        const newFourCardForStrength = sortedNew.find(c=>c.value === newFourValue);
        const oldFourCardForStrength = sortedOld.find(c=>c.value === oldFourValue);
        return valueOrder.indexOf(newFourCardForStrength.value) > valueOrder.indexOf(oldFourCardForStrength.value);
    } else { // 스트레이트, 플러쉬, 스트레이트 플러쉬
        // 가장 높은 카드의 서열로 비교, 같으면 해당 카드의 속성으로 비교
        return cardStrength(sortedNew[0]) > cardStrength(sortedOld[0]);
    }
  }

  // 싱글, 페어, 트리플 비교 (같은 타입, 같은 개수여야 함)
  if (newType === oldType && newType !== null && newCards.length === oldCards.length) {
    const newMaxCard = [...newCards].sort((a,b) => cardStrength(b) - cardStrength(a))[0];
    const oldMaxCard = [...oldCards].sort((a,b) => cardStrength(b) - cardStrength(a))[0];
    return cardStrength(newMaxCard) > cardStrength(oldMaxCard);
  }
  
  // 다른 개수의 카드를 내려고 할 때 (5장 조합이 아닌 경우)
  if (newCards.length !== oldCards.length) {
      return false; // 거부
  }

  return false; // 그 외 모든 경우 (타입이 다르거나 유효하지 않으면)
}


function rankCombo(type) {
  return combinationRank.indexOf(type);
}

// penalty 계산: 카드 2는 전체 패널티 2배, 나머지는 1점. (Plan Item 3: Verified - OK)
function calculatePenalty(hand) {
  let penalty = 0;
  let hasTwo = false;
  if (!hand || hand.length === 0) return 0;

  hand.forEach(card => {
    penalty++; // 기본 점수
    if (card.value === 2) {
      hasTwo = true;
    }
  });
  return hasTwo ? penalty * 2 : penalty;
}

// 투표 상태 업데이트
function updateGameStartVoteStatus() {
  const humanPlayers = players.filter(id => sockets[id] && !sockets[id].isAI && !eliminatedPlayers[id]);
  const votes = Object.keys(gameStartVotes).length;
  io.emit('gameStartVoteStatus', { votes, total: humanPlayers.length, nicknames });
}

function updateFinalVoteStatus() {
  const humanPlayers = players.filter(id => sockets[id] && !sockets[id].isAI && !eliminatedPlayers[id]);
  const votes = Object.keys(finalGameVotes).length;
  io.emit('rematchStatus', { votes, total: humanPlayers.length, nicknames });
}

// 각 플레이어의 남은 손패 수 업데이트
function updateHandCounts() {
  const handCounts = {};
  players.forEach((id, idx) => {
    if (eliminatedPlayers[id]) {
        handCounts[id] = '탈락';
    } else {
        handCounts[id] = hands[idx] ? hands[idx].length : 0;
    }
  });
  io.emit('handCounts', {handCounts, nicknames});
}

// --- AI 턴 관련 ---
function scheduleAIMove() {
  if (gameOver) return;
  const currentPlayerId = players[turnIndex];
  if (sockets[currentPlayerId] && sockets[currentPlayerId].isAI && !eliminatedPlayers[currentPlayerId]) {
    setTimeout(() => { aiMakeMove(currentPlayerId); }, 1000 + Math.random() * 1000); // AI 생각 시간
  }
}

function aiMakeMove(aiId) {
  if (gameOver || eliminatedPlayers[aiId]) return;

  const index = players.indexOf(aiId);
  const aiHand = hands[index];
  let chosenCombo = null;

  // 현재 턴이 AI이고, 이전 사람이 패스해서 선이 된 경우
  if (!lastPlayed) {
    // AI가 선일 때: 가능한 모든 조합 중 가장 약한 것부터 시도 (단, 좋은 패는 아껴야 함 - 이 부분은 복잡한 전략)
    // 일단은 간단하게 아무거나 냄. (싱글, 페어, 트리플 순으로)
    const typesToTry = ['single', 'pair', 'triple', 'straight', 'flush', 'fullhouse', 'four', 'straight_flush'];
    for (let type of typesToTry) {
        const combos = getAllCombinations(aiHand, type);
        if (combos.length > 0) {
            // 가장 약한 조합을 내도록 정렬 (낮은 숫자, 낮은 속성 우선)
            combos.sort((a, b) => {
                const aStrength = Math.max(...a.map(card => cardStrength(card)));
                const bStrength = Math.max(...b.map(card => cardStrength(card)));
                return aStrength - bStrength; 
            });
            chosenCombo = combos[0];
            break;
        }
    }
  } else {
    // 이전 카드를 받아치는 경우
    const combos = getAllCombinations(aiHand, currentComboType);
    const validCombos = combos.filter(combo => 
        combo.length === currentComboLength && isStronger(combo, lastPlayed)
    );

    if (validCombos.length > 0) {
      // 가장 약하게 이길 수 있는 조합 선택
      validCombos.sort((a, b) => {
        const aStrength = Math.max(...a.map(card => cardStrength(card)));
        const bStrength = Math.max(...b.map(card => cardStrength(card)));
        return aStrength - bStrength;
      });
      chosenCombo = validCombos[0];
    }
  }

  if (!chosenCombo) { // 낼 카드가 없을 때 패스
    const name = nicknames[aiId] || aiId;
    io.emit('chat', { sender: 'System', message: `${name}이(가) 패스했습니다.`, timestamp: new Date().toLocaleTimeString(), isPass: true });
    passCounter++;
    if (passCounter >= players.filter(p => !eliminatedPlayers[p]).length -1) { // 탈락하지 않은 플레이어 수 기준
      lastPlayed = null;
      currentComboType = null;
      currentComboLength = 0;
      passCounter = 0;
      io.emit('gameMessage', '모두 패스하여 턴이 초기화됩니다. 이전 선이 다시 선을 잡습니다.');
      io.emit('resetBoard');
      // 턴은 마지막으로 카드를 낸 사람에게 돌아가야하는데, 그 사람이 이미 탈락했을 수 있음.
      // 이 부분은 advanceTurn에서 이미 다음 사람으로 넘어가 있으므로, 여기서 턴을 변경하지 않고
      // advanceTurn이 호출되기 전의 turnIndex가 선이 됨.
      // 하지만 현재 로직은 패스하면 바로 다음 사람에게 턴이 넘어가므로,
      // 모두 패스했을 때 마지막으로 카드를 낸 사람이 선이 되도록 turnIndex를 설정해야함.
      // 이는 lastPlayedPlayerId 같은 변수를 통해 추적해야 할 수 있음.
      // 일단은 현재 턴 플레이어가 다시 선을 잡는 것으로 간주.
    }
    advanceTurn();
    scheduleAIMove();
    return;
  }

  // AI 카드 제출 로직
  chosenCombo.forEach(chosen => {
    const idx = aiHand.findIndex(card => card.value === chosen.value && card.suit === chosen.suit);
    if (idx !== -1) aiHand.splice(idx, 1);
  });

  lastPlayed = chosenCombo;
  currentComboType = getComboType(chosenCombo);
  currentComboLength = chosenCombo.length;
  passCounter = 0;
  io.emit('cardPlayed', { playerId: aiId, nickname: nicknames[aiId], comboType: currentComboType, cards: chosenCombo });
  updateHandCounts();

  if (aiHand.length === 0) {
    endRound(aiId); // AI 승리
    return;
  }

  advanceTurn();
  scheduleAIMove();
}

function advanceTurn() {
    if (gameOver) return;
    // Plan Item 10: Turn Advancement - Skips eliminated players.
    if (gameOver) return;
    const activePlayers = players.filter(p => !eliminatedPlayers[p]);
    if (activePlayers.length <= 1) { 
        endGameIfOnlyOneLeft();
        return;
    }

    let nextTurnIndex = turnIndex;
    do {
        nextTurnIndex = (nextTurnIndex + 1) % players.length;
    } while (eliminatedPlayers[players[nextTurnIndex]]); 
    
    turnIndex = nextTurnIndex;
    io.emit('turn', { playerId: players[turnIndex], nickname: nicknames[players[turnIndex]] });
}


// --- 라운드 및 게임 종료 처리 ---
// Plan Item 4: Round End Logic & Plan Item 7: Give Up Button
function endRound(winnerId) {
    if (gameOver) return; 
    gameOver = true; 

    let totalPenaltyFromLosers = 0;
    const roundPenalties = {};

    players.forEach((id, idx) => {
        if (id === winnerId) {
            roundPenalties[id] = 0; 
        } else if (!eliminatedPlayers[id] && hands[idx] && hands[idx].length > 0) { // 손패가 남아있는 패자
            const penalty = calculatePenalty(hands[idx]);
            totalPenaltyFromLosers += penalty;
            scores[id] = Math.max(0, scores[id] - penalty);
            roundPenalties[id] = -penalty;
            if (scores[id] === 0) {
                eliminatedPlayers[id] = true;
                io.emit('playerEliminated', { playerId: id, nickname: nicknames[id], scores });
                io.emit('gameMessage', `${nicknames[id]}님이 점수 부족으로 탈락했습니다!`);
            }
        } else {
            roundPenalties[id] = 0; // 이미 탈락했거나 손패가 없는 경우 페널티 없음
        }
    });

    if (!eliminatedPlayers[winnerId]) {
        scores[winnerId] += totalPenaltyFromLosers;
        roundPenalties[winnerId] = totalPenaltyFromLosers; 
    }
    
    updateScoreboardToAll(); // 점수 업데이트 먼저 보내기
    io.emit('roundOver', { winnerId, winnerNickname: nicknames[winnerId], roundPenalties, scores, eliminatedPlayers });
    io.emit('gameMessage', `${nicknames[winnerId]}님이 이번 라운드에서 승리했습니다!`);

    if (endGameIfOnlyOneLeft()) {
        return; 
    }

    // Plan Item 7: "Give Up" Button server logic
    io.emit('activateGiveUpButton');
    setTimeout(() => {
        io.emit('deactivateGiveUpButton');
        if (!checkFinalGameOver() && gameOver) { // gameOver가 여전히 true (즉, 최종 게임 종료 아님)
             startNewRound();
        }
    }, 5000); // Plan Item 7: 포기 시간 5초로 수정
}

// Plan Item 6: Overall Game Over Condition & Plan Item 4: Emissions
function endGameIfOnlyOneLeft() {
    const activePlayersWithPositiveScore = players.filter(id => !eliminatedPlayers[id] && scores[id] > 0);
    
    if (activePlayersWithPositiveScore.length <= 1) {
        const ultimateWinnerId = activePlayersWithPositiveScore.length === 1 ? activePlayersWithPositiveScore[0] : null;
        const winnerNickname = ultimateWinnerId ? nicknames[ultimateWinnerId] : "없음";
        
        io.emit('finalGameOver', { 
            winnerId: ultimateWinnerId, 
            winnerNickname: winnerNickname,
            message: ultimateWinnerId ? `${winnerNickname}님이 최종 승리했습니다!` : "모든 플레이어가 탈락했거나 점수가 없어 게임이 종료됩니다.",
            scores, // 전체 점수 현황
            nicknames, // 전체 닉네임
            eliminatedPlayers // 전체 탈락 현황
        });
        started = false; 
        // botGameMode는 다음 게임 시작 시 결정되므로 여기서 바꾸지 않음.
        finalGameVotes = {}; 
        gameStartVotes = {}; 
        return true; 
    }
    return false; 
}

// Plan Item 1 (dealTiles) & Plan Item 2 ("Cloud 3 Start" Rule)
function startNewRound() {
    if (checkFinalGameOver()) return; 

    resetRoundState(); 
    gameOver = false; 

    const activePlayersForDeal = players.filter(p => !eliminatedPlayers[p]);
    const activePlayerCount = activePlayersForDeal.length;

    if ((!botGameMode && activePlayerCount < MIN_PLAYERS) || activePlayerCount === 0) {
         endGameIfOnlyOneLeft(); // 여기서 최종 게임 종료 처리
         return;
    }
    
    // 카드 새로 배분 (탈락하지 않은 플레이어들에게만)
    const dealtHandsForActive = dealTiles(activePlayerCount); 
    
    // hands 배열을 전체 players 배열에 맞게 재구성
    hands = Array(players.length).fill(null).map(() => []); // 모든 플레이어에 대해 빈 배열로 초기화
    let currentDealtHandIndex = 0;
    players.forEach((pid, pidx) => {
        if (!eliminatedPlayers[pid]) {
            if (dealtHandsForActive[currentDealtHandIndex]) {
                 hands[pidx] = dealtHandsForActive[currentDealtHandIndex];
                 currentDealtHandIndex++;
            } else {
                // 카드를 받지 못한 활성 플레이어 (이론상 발생 안함)
                console.error(`Player ${nicknames[pid]} is active but did not receive cards.`);
                hands[pidx] = [];
            }
        } else {
            hands[pidx] = []; // 탈락자는 빈 손패
        }
    });


    // Plan Item 2: "Cloud 3 Start" Rule
    let cloud3PlayerIndex = -1;
    let firstActivePlayerIndex = -1; // 구름 3 없을 시 첫 활성 플레이어

    hands.forEach((hand, index) => {
        if (!eliminatedPlayers[players[index]]) { // 탈락하지 않은 플레이어 중에서
            if (firstActivePlayerIndex === -1) { // 첫번째 활성 플레이어 저장
                firstActivePlayerIndex = index;
            }
            if (hand.some(card => card.suit === '구름' && card.value === 3)) {
                cloud3PlayerIndex = index;
            }
        }
    });

    if (cloud3PlayerIndex !== -1) {
        turnIndex = cloud3PlayerIndex;
    } else if (firstActivePlayerIndex !== -1) { // 구름 3 없고 활성 플레이어가 있으면
        turnIndex = firstActivePlayerIndex; 
    } else { // 모든 플레이어가 탈락했거나 카드를 받지 못한 매우 예외적인 상황
        console.error("No active player found to start the round.");
        endGameIfOnlyOneLeft(); // 게임 종료 시도
        return;
    }
    
    io.emit('gameMessage', '새 라운드를 시작합니다.');
    if (cloud3PlayerIndex !== -1) {
        io.emit('gameMessage', `${nicknames[players[turnIndex]]}님이 구름 3을 가지고 시작합니다.`);
    } else {
        io.emit('gameMessage', `${nicknames[players[turnIndex]]}님부터 시작합니다 (구름 3 없음).`);
    }

    players.forEach((id, i) => {
        if (sockets[id] && hands[i]) { // hands[i]가 존재하고, 소켓이 있는 경우 (AI 포함)
            if (!eliminatedPlayers[id]) { // 탈락하지 않은 플레이어에게만 전송
                if (sockets[id].isAI) {
                    // AI는 hand 데이터가 이미 서버에 있으므로 별도 전송 불필요할 수 있으나,
                    // AI 로직이 hand를 직접 참조한다면 이 부분은 스킵 가능.
                    // 만약 AI가 클라이언트처럼 이벤트를 받는다면 여기서 처리.
                } else {
                    // 인간 플레이어에게 손패, 점수 등 정보 전송
                    sockets[id].emit('newRound', { 
                        hand: hands[i], 
                        scores, 
                        nicknames, 
                        eliminatedPlayers,
                        players: players.map(p => ({id: p, nickname: nicknames[p], eliminated: eliminatedPlayers[p]}))
                    });
                }
            }
        }
    });

    updateHandCounts();
    io.emit('resetBoard'); 
    io.emit('turn', { playerId: players[turnIndex], nickname: nicknames[players[turnIndex]] });
    scheduleAIMove(); 
}


function resetRoundState() {
  hands = Array(players.length).fill(null).map(() => []); // 각 플레이어의 손패 초기화
  lastPlayed = null;
  currentComboType = null;
  currentComboLength = 0;
  passCounter = 0;
  // gameOver는 startNewRound 시작 시 false로 설정됨
  // rematchVotes는 라운드 종료 시 처리되므로 여기서 초기화 불필요 (finalGameVotes 사용)
}

// Plan Item 5 & Plan Item 8: Bot Logic, Initial Score
function resetFullGameAndStart() {
  initializeScores(); // Plan Item 8: 점수 초기화 (봇 포함)
  
  gameStartVotes = {};
  finalGameVotes = {}; 
  started = true;
  gameOver = false; 
  // botGameMode는 triggerGameStart 또는 startBotGame에서 설정되므로 여기서 건드리지 않음.

  io.emit('hideOverlay'); 
  updateScoreboardToAll(); // 초기화된 점수 전송 (eliminatedPlayers 포함)

  startNewRound(); 
}


function checkFinalGameOver() {
    const activePlayers = players.filter(id => !eliminatedPlayers[id] && scores[id] > 0);
    return activePlayers.length <= 1;
}


// --- 소켓 이벤트 처리 ---
io.on('connection', (socket) => {
  // 게임이 이미 시작되었고, 현재 접속하려는 플레이어가 기존 플레이어가 아니면 접속 차단 (관전 기능 없을 시)
  // if (started && !players.includes(socket.id)) return socket.disconnect();
  
  // 최대 플레이어 수 초과 시 접속 차단 (봇 게임 모드 고려)
  if (players.filter(p => sockets[p] && !sockets[p].isAI).length >= MAX_PLAYERS && !botGameMode) {
      socket.emit('gameError', '최대 플레이어 수에 도달했습니다.');
      return socket.disconnect();
  }
  if (botGameMode && players.length >= MAX_PLAYERS) { // 봇게임인데 풀방이면
      socket.emit('gameError', '봇 게임이 이미 최대 인원으로 진행중입니다.');
      return socket.disconnect();
  }


  socket.on('setNickname', (data) => {
    if (data.nickname && data.nickname.trim().length > 0) {
        const oldNickname = nicknames[socket.id];
        nicknames[socket.id] = data.nickname.trim();
        // 만약 플레이어 목록에 아직 없다면 추가
        if (!players.includes(socket.id)) {
            players.push(socket.id);
            sockets[socket.id] = socket;
            scores[socket.id] = 64; // 기본 점수
            eliminatedPlayers[socket.id] = false;
        }
        io.emit('playerList', {players: players.map(p => ({id: p, nickname: nicknames[p]})), nicknames});
        io.emit('gameMessage', `${oldNickname || socket.id}님이 ${nicknames[socket.id]}(으)로 닉네임을 변경했습니다.`);
        updateGameStartVoteStatus(); // 플레이어 목록 변경 시 투표 상태 업데이트
        updateScoreboardToAll();
    }
  });
  
  // Plan Item 5: Bot Logic
  socket.on('triggerGameStart', (data) => {
    if (started) return socket.emit('gameError', '게임이 이미 진행 중입니다.');
    if (!nicknames[socket.id]) return socket.emit('gameError', '닉네임을 먼저 설정해주세요.');

    // data.mode 가 'bot' 또는 'human'으로 올 것을 기대
    if (data.mode === 'bot') {
        botGameMode = true; 
        // 봇 게임 시작 요청은 즉시 처리 (투표 없이)
        startBotGame(); // 봇 채우고 게임 시작 (내부에서 resetFullGameAndStart 호출)
        gameStartVotes = {}; // 투표 초기화
        return;
    }
    
    // 'human' 모드일 경우 투표 로직
    botGameMode = false;
    const humanPlayers = players.filter(id => sockets[id] && !sockets[id].isAI && !eliminatedPlayers[id]); // 현재 로비에 있는 인간 플레이어
    if (humanPlayers.length < MIN_PLAYERS) {
        return socket.emit('gameError', `최소 ${MIN_PLAYERS}명의 인간 플레이어가 필요합니다. 현재 ${humanPlayers.length}명.`);
    }

    if (!gameStartVotes[socket.id]) {
        gameStartVotes[socket.id] = true;
        updateGameStartVoteStatus();
    }

    // 모든 인간 플레이어가 투표했는지 확인
    const humanPlayerIdsInLobby = players.filter(id => sockets[id] && !sockets[id].isAI); // 로비의 모든 인간
    const readyHumanPlayers = humanPlayerIdsInLobby.filter(id => gameStartVotes[id]);

    if (humanPlayerIdsInLobby.length > 0 && readyHumanPlayers.length === humanPlayerIdsInLobby.length && humanPlayerIdsInLobby.length >= MIN_PLAYERS) {
        // 시작 조건 충족 시, 현재 로비에 있는 인간 플레이어들로만 `players` 목록 재구성
        const currentHumanPlayersData = humanPlayerIdsInLobby.map(id => ({
            id,
            socket: sockets[id],
            nickname: nicknames[id]
        }));
        
        players = currentHumanPlayersData.map(p => p.id);
        sockets = Object.fromEntries(currentHumanPlayersData.map(p => [p.id, p.socket]));
        nicknames = Object.fromEntries(currentHumanPlayersData.map(p => [p.id, p.nickname]));
        // scores, eliminatedPlayers는 resetFullGameAndStart 내부의 initializeScores에서 재설정됨

        resetFullGameAndStart(); 
        gameStartVotes = {}; 
    } else if (readyHumanPlayers.length === humanPlayerIdsInLobby.length && humanPlayerIdsInLobby.length < MIN_PLAYERS) {
        socket.emit('gameError', `투표는 완료되었으나, 최소 ${MIN_PLAYERS}명의 플레이어가 필요합니다. 현재 ${humanPlayerIdsInLobby.length}명.`);
        // 투표는 유지하고, 추가 인원 기다림 또는 투표 취소 로직 필요 시 추가
    }
  });
  
  // Plan Item 6: finalGameOver 이후 투표 (유지)
  socket.on('finalVote', (data) => {
    if (!nicknames[socket.id] || (eliminatedPlayers[socket.id] && scores[socket.id] === 0)) return; // 점수가 0이고 탈락한 사람은 투표 불가
    if (sockets[socket.id] && sockets[socket.id].isAI) return; 

    finalGameVotes[socket.id] = data.vote; 
    updateFinalVoteStatus();

    const humanPlayersAlive = players.filter(id => sockets[id] && !sockets[id].isAI && !eliminatedPlayers[id]);
    const votedPlayers = Object.keys(finalGameVotes);

    if (votedPlayers.length === humanPlayersAlive.length) {
      let rematchCount = 0, mainCount = 0, exitCount = 0;
      Object.values(finalGameVotes).forEach(vote => {
        if (vote === "rematch") rematchCount++;
        else if (vote === "main") mainCount++;
        else if (vote === "exit") exitCount++;
      });

      if (rematchCount >= mainCount && rematchCount >= exitCount) { // 재시작 우선
        io.emit('gameMessage', '투표 결과: 게임을 재시작합니다!');
        resetFullGameAndStart();
      } else if (mainCount > rematchCount && mainCount >= exitCount) {
        io.emit('gameMessage', '투표 결과: 모든 플레이어가 메인 메뉴로 돌아갑니다.');
        // 모든 플레이어 연결 해제 또는 특정 이벤트 전송
        players.forEach(pid => { if (sockets[pid] && !sockets[pid].isAI) sockets[pid].emit('redirectToMain'); });
        // 서버 상태 초기화 (플레이어 목록 등)
        resetServerStateForNewGame();
      } else { // 종료 또는 동률 시 종료 우선
        io.emit('gameMessage', '투표 결과: 게임을 종료합니다.');
        players.forEach(pid => { if (sockets[pid] && !sockets[pid].isAI) sockets[pid].emit('forceExit'); });
        resetServerStateForNewGame();
      }
      finalGameVotes = {}; // 투표 초기화
    }
  });
    
  socket.on('chat', ({ sender, message }) => {
    if (!sender || !message) return;
    const chatData = { sender: nicknames[socket.id] || sender, message, timestamp: new Date().toLocaleTimeString() };
    io.emit('chat', chatData);
  });
  
  socket.on('play', ({ cards }) => {
    if (gameOver || eliminatedPlayers[socket.id] || players[turnIndex] !== socket.id) {
      return socket.emit('invalidPlay', '카드를 낼 수 있는 상황이 아닙니다.');
    }
    if (!cards || cards.length === 0) return socket.emit('invalidPlay', '카드를 선택해야 합니다.');

    const playerHand = hands[players.indexOf(socket.id)];
    // 클라이언트에서 보낸 cards 객체가 실제 서버의 카드 객체와 참조가 다를 수 있으므로, value와 suit로 비교하여 손패에서 찾아야 함
    const actualCardsFromHand = cards.map(clientCard => 
        playerHand.find(serverCard => serverCard.value === clientCard.value && serverCard.suit === clientCard.suit)
    ).filter(card => card !== undefined); // 없는 카드 제거

    if (actualCardsFromHand.length !== cards.length) {
        return socket.emit('invalidPlay', '유효하지 않은 카드가 포함되어 있습니다. (손패에 없는 카드)');
    }

    const comboType = getComboType(actualCardsFromHand);
    if (!comboType) return socket.emit('invalidPlay', '유효하지 않은 카드 조합입니다.');

    if (lastPlayed) { // 이전 카드가 있을 때
      if (actualCardsFromHand.length !== currentComboLength) { // 5장 족보가 아닌 경우 개수가 같아야 함
         if (currentComboLength === 5 && actualCardsFromHand.length === 5) {
            // 5장 vs 5장: 족보 서열로만 비교
         } else {
            return socket.emit('invalidPlay', `같은 ${currentComboLength}장의 카드만 낼 수 있습니다.`);
         }
      }
      // 5장 족보 대결이거나, 같은 종류/개수의 패 대결
      if (!isStronger(actualCardsFromHand, lastPlayed)) {
        return socket.emit('invalidPlay', '이전에 나온 조합보다 약합니다.');
      }
    } else { // 선 플레이어일 때 (첫 턴 또는 모두 패스 후)
        // 구름 3을 가진 플레이어는 첫 턴에 구름 3을 포함한 조합을 내야 하는가? - 문제에는 "자유롭게 패를 등록할 기회"
        // "구름 3을 꼭 사용해서 패를 등록할 필요는 없지만" -> 자유롭게 가능.
    }

    // 카드 제거
    actualCardsFromHand.forEach(playedCard => {
      const idx = playerHand.findIndex(hCard => hCard.value === playedCard.value && hCard.suit === playedCard.suit);
      if (idx !== -1) playerHand.splice(idx, 1);
    });

    lastPlayed = actualCardsFromHand;
    currentComboType = comboType;
    currentComboLength = actualCardsFromHand.length;
    passCounter = 0;

    io.emit('cardPlayed', { playerId: socket.id, nickname: nicknames[socket.id], comboType, cards: actualCardsFromHand });
    updateHandCounts();

    if (playerHand.length === 0) {
      endRound(socket.id); // 현재 플레이어 승리
      return;
    }
    
    advanceTurn();
    scheduleAIMove();
  });
  
  socket.on('pass', () => {
    if (gameOver || eliminatedPlayers[socket.id] || players[turnIndex] !== socket.id) {
      return socket.emit('invalidPlay', '패스할 수 있는 상황이 아닙니다.');
    }
    if (!lastPlayed) { // 선 플레이어는 패스할 수 없음
        return socket.emit('invalidPlay', '선 플레이어는 패스할 수 없습니다.');
    }

    const name = nicknames[socket.id] || socket.id;
    io.emit('chat', { sender: 'System', message: `${name}님이 패스했습니다.`, timestamp: new Date().toLocaleTimeString(), isPass: true });
    passCounter++;

    const activePlayersCount = players.filter(p => !eliminatedPlayers[p]).length;
    // General: Pass counter logic & 선 (leader) change - Verified OK
    if (passCounter >= activePlayersCount - 1 && activePlayersCount > 0) { 
      lastPlayed = null;
      currentComboType = null;
      currentComboLength = 0;
      passCounter = 0;
      io.emit('gameMessage', '모든 플레이어가 패스했습니다. 이전 턴에 카드를 낸 플레이어가 선을 잡습니다.');
      io.emit('resetBoard');
       io.emit('turn', { playerId: players[turnIndex], nickname: nicknames[players[turnIndex]] }); 
       scheduleAIMove(); 
       return;
    }
    
    advanceTurn();
    scheduleAIMove();
  });
  
  // Plan Item 7: "Give Up" Button server logic - Verified timeout, added !gameOver check for advanceTurn
  socket.on('giveup', () => {
    if (eliminatedPlayers[socket.id] && scores[socket.id] === 0) return; // 이미 점수0으로 탈락한 경우
    if (!started) return; 
    
    scores[socket.id] = 0; 
    eliminatedPlayers[socket.id] = true;
    io.emit('playerEliminated', { playerId: socket.id, nickname: nicknames[socket.id], scores, nicknames, eliminatedPlayers });
    io.emit('gameMessage', `${nicknames[socket.id]}님이 게임을 포기했습니다.`);
    updateScoreboardToAll();
    updateHandCounts(); 

    if (endGameIfOnlyOneLeft()) {
        return;
    }

    // 현재 턴인 플레이어가 포기했고, 라운드/게임이 아직 끝나지 않았다면 턴 넘김
    if (players[turnIndex] === socket.id && !gameOver && !checkFinalGameOver()) { 
        advanceTurn();
        scheduleAIMove();
    }
  });
  
  // Plan Item 9: Player Disconnection
  socket.on('disconnect', () => {
    const disconnectedPlayerId = socket.id;
    const playerNickname = nicknames[disconnectedPlayerId] || disconnectedPlayerId;
    const isHumanPlayer = sockets[disconnectedPlayerId] && !sockets[disconnectedPlayerId].isAI;

    io.emit('gameMessage', `${playerNickname}님이 접속을 종료했습니다.`);
    
    if (isHumanPlayer) {
        if (started) { // 게임 중에 연결이 끊긴 경우
            if (!eliminatedPlayers[disconnectedPlayerId]) { // 아직 탈락하지 않았다면 탈락 처리
                scores[disconnectedPlayerId] = 0;
                eliminatedPlayers[disconnectedPlayerId] = true;
                io.emit('playerEliminated', { playerId: disconnectedPlayerId, nickname: playerNickname, scores, nicknames, eliminatedPlayers });
                io.emit('gameMessage', `${playerNickname}님의 연결이 끊어져 탈락 처리되었습니다.`);
                updateHandCounts();
            }
            // sockets에서 해당 플레이어 제거 (AI로 대체하지 않는 경우)
            delete sockets[disconnectedPlayerId]; 
        } else { // 로비에서 연결이 끊긴 경우
            // 플레이어 목록에서 완전히 제거
            players = players.filter(pId => pId !== disconnectedPlayerId);
            delete sockets[disconnectedPlayerId];
            delete nicknames[disconnectedPlayerId];
            delete scores[disconnectedPlayerId]; // 로비에서도 점수 객체는 있을 수 있으므로 제거
            delete eliminatedPlayers[disconnectedPlayerId];
        }
        
        delete gameStartVotes[disconnectedPlayerId];
        delete finalGameVotes[disconnectedPlayerId];
    }
    // AI의 disconnect는 서버에서 관리하므로 별도 처리 불필요

    updatePlayerListsAndScoresToAll(); 

    if (started) { 
        if (players[turnIndex] === disconnectedPlayerId && !gameOver && !checkFinalGameOver()) { 
            advanceTurn();
            scheduleAIMove();
        }
        endGameIfOnlyOneLeft(); 
    } else { 
        updateGameStartVoteStatus();
        const humanPlayersLeft = players.filter(pId => sockets[pId] && !sockets[pId].isAI);
        if (humanPlayersLeft.length === 0 && !botGameMode) { 
            // resetServerStateForNewGame(); // 모든 인간이 나가면 서버 초기화 (선택적)
            // 현재는 로비가 계속 유지되는 형태
        }
    }
  });

  // 초기 접속 시 플레이어에게 현재 게임 상태 전송
  socket.emit('requestNickname'); // 클라이언트에게 닉네임 입력을 요청
  // 접속 시 이미 진행중인 게임이 있다면, 관전모드 또는 게임 정보 제공 가능
  if (started) {
    socket.emit('gameInProgress', {scores, nicknames, eliminatedPlayers, currentTurn: players[turnIndex], lastPlayed});
  } else {
    updateGameStartVoteStatus(); // 대기실 상태 업데이트
  }
  updateScoreboardToAll(); // 접속자에게 현재 스코어보드 전송
});


// Plan Item 5: Bot Logic
function startBotGame() {
  if (started) return;
  botGameMode = true; // 봇 게임 모드 명시적 설정
  
  // 기존 인간 플레이어 유지, AI 플레이어는 모두 제거 후 다시 추가
  const humanPlayerObjects = [];
  players.forEach(pid => {
      if (sockets[pid] && !sockets[pid].isAI) {
          humanPlayerObjects.push({id: pid, socket: sockets[pid], nickname: nicknames[pid]});
      }
  });

  players = humanPlayerObjects.map(p => p.id);
  sockets = Object.fromEntries(humanPlayerObjects.map(p => [p.id, p.socket]));
  nicknames = Object.fromEntries(humanPlayerObjects.map(p => [p.id, p.nickname]));
  // scores, eliminatedPlayers는 initializeScores에서 처리됨

  const neededBots = MAX_PLAYERS - players.length;
  if (neededBots < 0) { // 인간 플레이어가 MAX_PLAYERS를 초과하는 경우는 없어야 하지만 안전장치
      console.warn("Too many human players for bot game. Trimming.");
      // players, sockets, nicknames를 MAX_PLAYERS만큼 자르는 로직 추가 필요 (여기선 생략)
  }

  for (let i = 0; i < neededBots; i++) {
    const aiId = `AI-${Date.now()}-${i}`;
    players.push(aiId);
    sockets[aiId] = { isAI: true, id: aiId, emit: () => {} }; // AI는 emit 사용 안 함
    nicknames[aiId] = `봇${i+1}`;
    // scores[aiId] = 64; // initializeScores 에서 처리
    // eliminatedPlayers[aiId] = false; // initializeScores 에서 처리
  }
  
  io.emit('playerList', {players: players.map(p => ({id: p, nickname: nicknames[p], eliminated: eliminatedPlayers[p]})), nicknames});
  resetFullGameAndStart(); // 내부에서 initializeScores 호출하여 모든 플레이어 점수 설정
}

// 서버 상태 초기화 (모든 플레이어 나갔을 때, 또는 관리자 요청 시)
function resetServerStateForNewGame() {
    players = [];
    sockets = {};
    nicknames = {};
    hands = [];
    deck = [];
    turnIndex = 0;
    lastPlayed = null;
    currentComboType = null;
    currentComboLength = 0;
    passCounter = 0;
    scores = {};
    eliminatedPlayers = {};
    started = false;
    botGameMode = false;
    gameOver = false;
    rematchVotes = {};
    gameStartVotes = {};
    finalGameVotes = {};
    io.emit('gameReset'); // 클라이언트에게 게임이 완전히 리셋되었음을 알림
    console.log("서버 상태가 초기화되었습니다.");
}

function updateScoreboardToAll() {
    io.emit('scoreUpdate', {scores, nicknames, eliminatedPlayers});
}

function updatePlayerListsAndScoresToAll() {
    io.emit('playerList', {players: players.map(p => ({id: p, nickname: nicknames[p], eliminated: eliminatedPlayers[p]})), nicknames});
    updateScoreboardToAll();
    updateHandCounts();
}


http.listen(PORT, () => {
  console.log(`🟢 Lexio server running at http://localhost:${PORT}`);
});
