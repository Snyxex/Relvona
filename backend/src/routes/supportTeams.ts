import { Router } from "express";
import { authenticate, tenantContext, requireRole, type AuthRequest } from "../middleware/auth.js";
import { TeamRoutingService } from "../services/teamRoutingService.js";
import { SupportCoverageService } from "../services/supportCoverageService.js";
import { sendInternalError } from "../utils/httpErrors.js";
const router=Router();
router.use(authenticate,tenantContext,requireRole(["owner","admin","agent"]));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.get("/",async(req:AuthRequest,res)=>{try{return res.json(await TeamRoutingService.teams(req.organization!.id));}catch(e){return sendInternalError(req,res,e,{code:"TEAMS_LIST_FAILED",message:"Unable to list teams"});}});
router.post("/",requireRole(["owner","admin"]),async(req:AuthRequest,res)=>{try{return res.status(201).json(await TeamRoutingService.saveTeam(req.organization!.id,req.body||{}));}catch(e){if(e instanceof Error&&/Invalid|not an active/.test(e.message))return res.status(400).json({error:e.message});return sendInternalError(req,res,e,{code:"TEAM_CREATE_FAILED",message:"Unable to create team"});}});
router.put("/:id",requireRole(["owner","admin"]),async(req:AuthRequest,res)=>{try{if(!UUID.test(req.params.id))return res.status(400).json({error:"Invalid team ID"});return res.json(await TeamRoutingService.saveTeam(req.organization!.id,req.body||{},req.params.id));}catch(e){if(e instanceof Error&&/Invalid|not found|not an active/.test(e.message))return res.status(400).json({error:e.message});return sendInternalError(req,res,e,{code:"TEAM_UPDATE_FAILED",message:"Unable to update team"});}});
router.put("/:id/members",requireRole(["owner","admin"]),async(req:AuthRequest,res)=>{try{if(!UUID.test(req.params.id))return res.status(400).json({error:"Invalid team ID"});return res.json(await TeamRoutingService.setMembers(req.organization!.id,req.params.id,req.body?.userIds));}catch(e){if(e instanceof Error&&/Invalid|not found|not an active/.test(e.message))return res.status(400).json({error:e.message});return sendInternalError(req,res,e,{code:"TEAM_MEMBERS_FAILED",message:"Unable to update team members"});}});
router.post("/tickets/:id/route",requireRole(["owner","admin"]),async(req:AuthRequest,res)=>{try{if(!UUID.test(req.params.id)||req.body?.teamId&&!UUID.test(req.body.teamId))return res.status(400).json({error:"Invalid ID"});return res.json(await TeamRoutingService.routeTicket(req.organization!.id,req.params.id,req.body?.teamId));}catch(e){if(e instanceof Error&&/not found/.test(e.message))return res.status(404).json({error:e.message});return sendInternalError(req,res,e,{code:"TICKET_ROUTE_FAILED",message:"Unable to route ticket"});}});
router.get("/sla-escalations",requireRole(["owner","admin"]),async(req:AuthRequest,res)=>{try{return res.json(await TeamRoutingService.escalationSettings(req.organization!.id));}catch(e){return sendInternalError(req,res,e,{code:"ESCALATION_SETTINGS_FAILED",message:"Unable to load escalation settings"});}});
router.put("/sla-escalations",requireRole(["owner","admin"]),async(req:AuthRequest,res)=>{try{return res.json(await TeamRoutingService.updateEscalationSettings(req.organization!.id,req.body||{}));}catch(e){if(e instanceof Error&&/Invalid/.test(e.message))return res.status(400).json({error:e.message});return sendInternalError(req,res,e,{code:"ESCALATION_SETTINGS_FAILED",message:"Unable to update escalation settings"});}});

router.get("/coverage", requireRole(["owner","admin"]), async (req:AuthRequest,res)=>{
 try {return res.json(await SupportCoverageService.list(req.organization!.id));}
 catch(e){return sendInternalError(req,res,e,{code:"COVERAGE_LOAD_FAILED",message:"Unable to load coverage rules"});}
});
router.get("/coverage/roster", requireRole(["owner","admin"]), async (req:AuthRequest,res)=>{
 try {return res.json(await SupportCoverageService.roster(req.organization!.id));}
 catch(e){return sendInternalError(req,res,e,{code:"ROSTER_LOAD_FAILED",message:"Unable to load team workload"});}
});
router.put("/coverage/schedules/:userId", requireRole(["owner","admin"]), async (req:AuthRequest,res)=>{
 try {
  if(!UUID.test(req.params.userId))return res.status(400).json({error:"Invalid user ID"});
  return res.json(await SupportCoverageService.upsertSchedule(req.organization!.id,req.params.userId,req.body||{}));
 }catch(e){
  if(e instanceof Error&&/Invalid|Overlapping|not an active/.test(e.message))return res.status(400).json({error:e.message});
  return sendInternalError(req,res,e,{code:"SCHEDULE_SAVE_FAILED",message:"Unable to save working hours"});
 }
});
router.post("/coverage/absences", requireRole(["owner","admin"]), async (req:AuthRequest,res)=>{
 try{return res.status(201).json(await SupportCoverageService.createAbsence(req.organization!.id,req.body||{}));}
 catch(e){
  if(e instanceof Error&&/Invalid|overlaps|not an active/.test(e.message))return res.status(400).json({error:e.message});
  return sendInternalError(req,res,e,{code:"ABSENCE_SAVE_FAILED",message:"Unable to save absence"});
 }
});
router.delete("/coverage/absences/:id", requireRole(["owner","admin"]), async (req:AuthRequest,res)=>{
 try {
  if(!UUID.test(req.params.id))return res.status(400).json({error:"Invalid absence ID"});
  const deleted=await SupportCoverageService.deleteAbsence(req.organization!.id,req.params.id);
  return deleted?res.status(204).end():res.status(404).json({error:"Absence not found"});
 }catch(e){return sendInternalError(req,res,e,{code:"ABSENCE_DELETE_FAILED",message:"Unable to delete absence"});}
});

export default router;
