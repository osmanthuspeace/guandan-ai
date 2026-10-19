/** 随机策略：基线 bot（M1 里程碑与对战基准）。 */
import { Action, GameState, Policy } from "../types.js";

export class RandomPolicy implements Policy {
  readonly name = "random";
  chooseAction(_state: GameState, actions: Action[]): number {
    return Math.floor(Math.random() * actions.length);
  }
}
