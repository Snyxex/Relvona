import { RAGService } from "./ragService.js";

export { RAGService };
export const processCustomerMessage = RAGService.generateRAGAnswer;
export const generateAiReply = RAGService.generateSuggestedReply;
