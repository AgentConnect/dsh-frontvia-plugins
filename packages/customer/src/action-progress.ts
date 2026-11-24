import { AsyncLocalStorage } from "node:async_hooks";
import { fail } from "./state.js";

export type ActionPhase = "prepare" | "approval" | "request" | "response";
type Report = (phase: Exclude<ActionPhase, "prepare">) => void;
export const actionObserver = new AsyncLocalStorage<Report>();

/** Transient display state for one owner request. Completion and recovery stay in the business flow. */
export class ActionProgress {
  private readonly active = new Map<string, ActionPhase>();

  read(key: string) { return this.active.get(key); }

  async track<T>(key: string, run: () => Promise<T>) {
    if (this.active.has(key)) fail("ACTION_IN_PROGRESS");
    this.active.set(key, "prepare");
    try {
      return await actionObserver.run(phase => this.active.set(key, phase), run);
    } finally {
      this.active.delete(key);
    }
  }
}

type Timing = {stage:string;ms:number};
const timings = new AsyncLocalStorage<Timing[]>();

/** Opt-in, content-free measurements. Concurrent reads may overlap. */
export async function measure<T>(stage:string, read:()=>Promise<T>):Promise<T>{
  const samples=timings.getStore();
  if(!samples)return read();
  const start=performance.now();
  try{return await read();}
  finally{samples.push({stage,ms:Math.round(performance.now()-start)});}
}

export async function timeOwnerRequest<T>(operation:string, reference:string, run:()=>Promise<T>) {
  if(process.env.FRONTVIA_CUSTOMER_TIMINGS!=="1")return run();
  const samples:Timing[]=[];
  try{return await timings.run(samples,()=>measure("owner",run));}
  finally{console.info(JSON.stringify({event:"frontvia_customer_timing",operation,reference,samples}));}
}
