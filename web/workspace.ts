import { parsePlan, serializePlan, readWorkspace, writeWorkspace, type SavedWorkspace } from "./plan_files.ts";
import { type MapStateSnapshot } from "./map_generator_ui.ts";
import { type Rules } from "../src/rules.ts";
import { type ResearchCatalog } from "../src/board_file.ts";

/** Only the free-mode owner may call update. Failed reads never authorize overwriting storage. */
export class PlanWorkspace {
  saved: SavedWorkspace = {};
  status = "尚未保存";
  blocked = false;
  private last = "";
  private storage: Pick<Storage, "getItem" | "setItem">;
  private rules: Rules;
  private catalog: ResearchCatalog;
  private build: string;
  constructor(storage: Pick<Storage, "getItem" | "setItem">,
    rules: Rules, catalog: ResearchCatalog, build: string) {
    this.storage = storage; this.rules = rules; this.catalog = catalog; this.build = build;
    try {
      const saved = readWorkspace(storage);
      for (const value of Object.values(saved)) if (value) parsePlan(value, rules, catalog);
      this.saved = saved;
      this.last = saved.current ?? "";
      this.status = saved.current ? "已恢复本机自由局面" : "尚未保存";
    } catch (e) { this.blocked = true; this.status = `无法读取本机存档，原数据保留。${(e as Error).message}`; }
  }
  parse(text: string) { return parsePlan(text, this.rules, this.catalog); }
  encode(state: MapStateSnapshot) { return serializePlan(state, this.build); }
  restore(slot: "current" | "A" | "B") {
    const value = this.saved[slot];
    return value ? this.parse(value) : undefined;
  }
  private persist() {
    if (this.blocked) return;
    try { writeWorkspace(this.storage, this.saved); this.status = "已自动保存到本机"; }
    catch (e) { this.status = `仅保留在本次窗口；本机保存失败，请导出 JSON。${(e as Error).message}`; }
  }
  update(state: MapStateSnapshot) {
    try {
      const text = this.encode(state);
      if (text === this.last) return;
      this.last = text; this.saved.current = text; this.persist();
    } catch (e) { this.status = `当前局面未保存，请导出或缩小局面。${(e as Error).message}`; }
  }
  saveSlot(slot: "A" | "B", state: MapStateSnapshot) {
    this.saved[slot] = this.encode(state); this.persist();
  }
}
