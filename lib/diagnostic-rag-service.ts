// src/lib/diagnostic-rag-service.ts
// Diagnostic version to check actual embedding dimensions

import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantClient } from "@qdrant/js-client-rest";

export class DiagnosticRAGService {
  private embeddings: GoogleGenerativeAIEmbeddings;
  private qdrantClient: QdrantClient;
  private collectionName: string = 'rag_documents_collection';

  constructor(googleApiKey: string, qdrantUrl: string = "http://localhost:6333", qdrantApiKey?: string) {
    this.embeddings = new GoogleGenerativeAIEmbeddings({
      apiKey: googleApiKey,
      modelName: "text-embedding-004",
      taskType: "RETRIEVAL_DOCUMENT",
    });

    this.qdrantClient = new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey || undefined,
    });
  }

  async diagnose(): Promise<{
    embeddingDimensions: number;
    collectionExists: boolean;
    collectionDimensions?: number;
    recommendation: string;
  }> {
    try {
      console.log("🔍 Running diagnostic check...");

      // Test embedding dimensions
      console.log("🧪 Testing embedding model...");
      const testEmbedding = await this.embeddings.embedQuery("test");
      const actualEmbeddingDims = testEmbedding.length;
      console.log(`📏 Embedding model produces ${actualEmbeddingDims} dimensions`);

      // Check collection
      console.log("🔍 Checking Qdrant collection...");
      const collections = await this.qdrantClient.getCollections();
      const existingCollection = collections.collections.find(
        (col) => col.name === this.collectionName
      );

      let collectionDimensions: number | undefined;
      let collectionExists = false;

      if (existingCollection) {
        collectionExists = true;
        console.log("📁 Collection exists, checking dimensions...");
        
        try {
          const collectionInfo = await this.qdrantClient.getCollection(this.collectionName);
          
          // Extract dimensions
          if (collectionInfo.config?.params?.vectors) {
            const vectorsConfig = collectionInfo.config.params.vectors;
            if (typeof vectorsConfig === 'object' && 'size' in vectorsConfig) {
              collectionDimensions = vectorsConfig.size as number;
            }
          }
          
          console.log(`📐 Collection configured for ${collectionDimensions} dimensions`);
        } catch (error) {
          console.log("⚠️ Could not read collection dimensions");
        }
      } else {
        console.log("📁 Collection does not exist");
      }

      // Provide recommendation
      let recommendation = "";
      
      if (!collectionExists) {
        recommendation = `✅ Collection will be created automatically with ${actualEmbeddingDims} dimensions.`;
      } else if (collectionDimensions && collectionDimensions !== actualEmbeddingDims) {
        recommendation = `❌ DIMENSION MISMATCH! Collection expects ${collectionDimensions} but model produces ${actualEmbeddingDims}. You need to delete the collection.`;
      } else if (collectionDimensions === actualEmbeddingDims) {
        recommendation = `✅ Dimensions match! Collection (${collectionDimensions}) matches embedding model (${actualEmbeddingDims}).`;
      } else {
        recommendation = `⚠️ Could not determine collection dimensions. Consider recreating the collection.`;
      }

      return {
        embeddingDimensions: actualEmbeddingDims,
        collectionExists,
        collectionDimensions,
        recommendation
      };

    } catch (error) {
      console.error("❌ Diagnostic failed:", error);
      throw error;
    }
  }

  async forceDeleteCollection(): Promise<void> {
    try {
      console.log("🗑️ Force deleting collection...");
      await this.qdrantClient.deleteCollection(this.collectionName);
      console.log("✅ Collection deleted successfully");
    } catch (error) {
      console.log("⚠️ Collection might not exist or already deleted");
    }
  }
}