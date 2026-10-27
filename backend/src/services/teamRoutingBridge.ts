import { domainEventBus } from "./domainEventBus.js";
import { withDatabaseTenantContext, setDatabaseTenant } from "../db/tenantContext.js";
import { TeamRoutingService } from "./teamRoutingService.js";
let registered=false;
export function registerTeamRoutingBridge(){
 if(registered)return;registered=true;
 domainEventBus.subscribe("ticket.created",async event=>{
  const id=typeof event.payload.id==="string"?event.payload.id:"";
  if(!id)return;
  try{
   await withDatabaseTenantContext(async()=>{
    setDatabaseTenant(event.organizationId);
    await TeamRoutingService.routeTicket(event.organizationId,id);
   });
  }catch(error){
   console.error(JSON.stringify({event:"support.auto_route_failed",organizationId:event.organizationId,ticketId:id,error:error instanceof Error?error.message.slice(0,200):"unknown"}));
  }
 });
}
