/**
 * 离线冒烟测试：不连服务器，直接验证各算法模块可运行。
 * 用法：tsx src/smoke.ts
 */
import { arrange } from "./policy/arrange.js";
import { HandEvaluator } from "./policy/evaluate.js";
import { RulePolicy } from "./policy/rule.js";
import { CardTracker, fullDeck } from "./search/tracker.js";
import { predict } from "./search/predict.js";
import { EndgameSearch, sampleHands, genMoves, canBeat } from "./search/endgame.js";
import { RouterPolicy } from "./ai/router.js";
import { Action, GameState } from "./types.js";

let failed = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "ok " : "FAIL"} ${name}`);
  if (!cond) failed++;
}

// --- 组牌 ---
const deck = fullDeck();
const hand = deck.sort(() => Math.random() - 0.5).slice(0, 27);
const ev = new HandEvaluator();
const arr = arrange(hand, "2", ev);
check("组牌覆盖全部手牌", arr.groups.flatMap((g) => g.cards).length === 27);
check("组牌评估可打分", Number.isFinite(ev.score(arr, "2")));
// 组牌缓存：同一手牌重复组应命中同一结果
check("组牌缓存命中", arrange(hand, "2", ev) === arr);
// 组牌应能不靠逢人配组成 10JQKA（A 高顺）
const aHighArr = arrange(["ST", "HJ", "CQ", "DK", "SA", "S2", "H3"], "7", ev);
const aHighStraight = aHighArr.groups.find((g) => g.pattern === "Straight");
check("组牌可组成10JQKA", aHighStraight !== undefined && aHighStraight.rank === "A");

// --- 牌理决策 ---
function makeState(handCards: string[], actions: Action[], greaterPos = -1): GameState {
  return {
    myPos: 0, handCards,
    publicInfo: [handCards.length, 20, 20, 20].map((rest) => ({ rest })),
    selfRank: "2", oppoRank: "2", curRank: "2",
    curPos: 0, greaterPos, curAction: null, greaterAction: null,
    history: [], finished: [], stage: "play",
  };
}
const rule = new RulePolicy();
const myHand = ["S3", "H3", "C4", "D4", "S5", "H5", "C6", "D6", "S7", "H7"];
const acts: Action[] = [
  ["Single", "3", ["S3"]],
  ["Pair", "3", ["S3", "H3"]],
  ["Straight", "7", ["S3", "C4", "S5", "C6", "S7"]],
];
const pick = rule.chooseAction(makeState(myHand, acts), acts);
check("牌理返回合法索引", pick >= 0 && pick < acts.length);

// --- 记牌器与预测 ---
const tracker = new CardTracker();
const st = makeState(myHand, acts);
tracker.update(st);
check("未见牌数 = 108-10", tracker.unseenCards([]).length === 98);
const pred = predict(st, tracker);
check("预测输出四座位嫌疑", pred.bombRisk.length === 4);

// --- 末局搜索（小规模） ---
const eg = new EndgameSearch(tracker, { samples: 4, maxCandidates: 3, depth: 10, nodeBudget: 2000, timeMs: 500 });
const smallState: GameState = {
  myPos: 0, handCards: ["S5", "H5", "D9"],
  publicInfo: [3, 4, 5, 4].map((rest) => ({ rest })),
  selfRank: "2", oppoRank: "2", curRank: "2",
  curPos: 0, greaterPos: -1, curAction: null, greaterAction: null,
  history: [], finished: [], stage: "play",
};
tracker.update(smallState);
const egActs: Action[] = [
  ["Single", "5", ["S5"]],
  ["Pair", "5", ["S5", "H5"]],
  ["Single", "9", ["D9"]],
];
const t0 = Date.now();
const egPick = eg.chooseAction(smallState, egActs);
check("末局搜索返回合法索引", egPick >= 0 && egPick < egActs.length);
check(`末局搜索耗时 ${Date.now() - t0}ms`, Date.now() - t0 < 3000);
check("采样手牌张数正确", sampleHands(smallState, tracker)[1].length === 4);
check("genMoves 含 PASS", genMoves(["S5"], "2", ["Single", "6", ["D6"]]).some((a) => a[0] === "PASS"));
check("canBeat 对压对", canBeat(["Pair", "7", ["S7", "H7"]], ["Pair", "6", ["S6", "H6"]], "2"));
check("炸弹压非炸", canBeat(["Bomb", "5", ["S5", "H5", "C5", "D5"]], ["Single", "R", ["HR"]], "2"));

// --- Router 全流程 ---
const router = new RouterPolicy({ samples: 4, timeMs: 300 });
const rp = router.chooseAction(smallState, egActs);
check("Router 返回合法索引", rp >= 0 && rp < egActs.length);

console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
