import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { OpenAIEmbeddings } from "@langchain/openai";
import { db } from "../db/index.js";
import { documentEmbeddings } from "../db/schema.js";

// Helper to compute deterministic or OpenAI embeddings
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey && apiKey !== "your_openai_api_key_here") {
    const embeddingsModel = new OpenAIEmbeddings({ openAIApiKey: apiKey, modelName: "text-embedding-3-small" });
    return await embeddingsModel.embedQuery(text);
  } else {
    // Fallback pseudo-embedding generator (1536 floats) if API key is not configured for local development/testing
    const hash = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const vec: number[] = new Array(1536);
    for (let i = 0; i < 1536; i++) {
      vec[i] = Math.sin(hash + i) * 0.1;
    }
    return vec;
  }
}

export async function chunkAndEmbedDocument(workspaceId: string, sourceId: string, textContent: string, metadata: Record<string, any> = {}) {
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 600,
    chunkOverlap: 100,
  });

  const docs = await textSplitter.createDocuments([textContent]);

  for (const doc of docs) {
    const vectorVal = await generateEmbedding(doc.pageContent);
    await db.insert(documentEmbeddings).values({
      workspaceId,
      sourceId,
      content: doc.pageContent,
      metadata: { ...metadata, ...doc.metadata },
      embedding: vectorVal,
    });
  }

  return docs.length;
}
