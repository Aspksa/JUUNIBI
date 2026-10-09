import { expect, it } from "vitest";
import { BrainCore } from "./brain";
it("Brain 5.0 persists owner-attested outcomes without promoting unconfirmed guesses", async () => {
 let data:string|null=null;
 const storage={load:async()=>data,save:async (v:string)=>{data=v;}};
 const first=new BrainCore(()=>true,storage);
 const decision=first.recordDecision({goal:"Choose module",chosen:"stable",reason:"validated constraint",predictedSuccess:true});
 expect(first.decisionHistory().summary.confirmed).toBe(0);
 first.confirmDecision(decision.id,"failure");
 await first.flush();
 const second=new BrainCore(()=>true,storage);
 await second.load();
 expect(second.decisionHistory().summary).toMatchObject({total:1,confirmed:1,predictionAccuracy:0});
 expect(second.decisionHistory().records[0]?.observed).toBe("failure");
});
