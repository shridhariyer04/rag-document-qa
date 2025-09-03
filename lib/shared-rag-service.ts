// src/lib/shared-rag-service.ts
// Updated shared RAG service with correct vector dimensions

import { AutoFixRAGService } from './rag-system';

// Global shared instance
let sharedRAGService: AutoFixRAGService | null = null;

export function getRAGService(): AutoFixRAGService {
  if (!sharedRAGService) {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY not configured');
    }

    // Use a fixed collection name
    const fixedCollectionName = 'FINAL_RAG_COLLECTIONS';
    
    // Use 768 dimensions to match text-embedding-004 model
    const vectorDimensions = 768;
    
    sharedRAGService = new AutoFixRAGService(
      process.env.GOOGLE_API_KEY,
      process.env.QDRANT_URL || "http://localhost:6333",
      process.env.QDRANT_API_KEY,
      fixedCollectionName,
    );
    
    console.log(`Initialized RAG service with ${vectorDimensions} vector dimensions`);
  }
  
  return sharedRAGService;
}

// Function to reset the service (for clearing)
export function resetRAGService(): void {
  sharedRAGService = null;
  console.log('RAG service reset');
}