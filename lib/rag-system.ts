import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { QdrantVectorStore } from "@langchain/qdrant";
import { Document } from "langchain/document";
import { QdrantClient } from "@qdrant/js-client-rest";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { v4 as uuidv4 } from "uuid";
import { AIMessageChunk } from "@langchain/core/messages";

let pdfParse: any = null;

interface RagConfig {
  googleApiKey: string;
  qdrantUrl: string;
  qdrantApiKey?: string;
  collectionName?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  maxTokens?: number;
  temperature?: number;
}

interface QAResult {
  answer: string;
  sources: Document[];
  confidence: number;
  metadata?: {
    retrievalTime: number;
    generationTime: number;
    chunksUsed: number;
  };
}

class AutoFixRAGSystem {
  private embeddings: GoogleGenerativeAIEmbeddings;
  private llm: ChatGoogleGenerativeAI;
  private qdrantClient: QdrantClient;
  private vectorStore: QdrantVectorStore | null = null;
  private retrievalChain: any = null;
  private config: Required<RagConfig>;
  private collectionName: string;
  private actualVectorSize: number | null = null;

  constructor(config: RagConfig) {
    if (!config.googleApiKey) {
      throw new Error('Google API key is required');
    }

    this.config = {
      chunkSize: 1000,
      chunkOverlap: 200,
      maxTokens: 8192,
      temperature: 0.3,
      collectionName: config.collectionName || 'rag_documents_collection',
      qdrantApiKey: "",
      ...config
    };

    this.collectionName = this.config.collectionName;

    try {
      this.embeddings = new GoogleGenerativeAIEmbeddings({
        apiKey: this.config.googleApiKey,
        modelName: "text-embedding-004",
        taskType: "RETRIEVAL_DOCUMENT",
      });

      this.llm = new ChatGoogleGenerativeAI({
        apiKey: this.config.googleApiKey,
        model: "gemini-1.5-flash",
        maxOutputTokens: this.config.maxTokens,
        temperature: this.config.temperature,
      });

      this.qdrantClient = new QdrantClient({
        url: this.config.qdrantUrl,
        apiKey: this.config.qdrantApiKey || undefined,
      });

      console.log('Auto-Fix RAG System initialized');
    } catch (error) {
      console.error('Error initializing RAG System:', error);
      throw new Error(`Failed to initialize RAG System: ${error}`);
    }
  }

  private async loadPdfParse() {
    if (!pdfParse) {
      try {
        pdfParse = (await import('pdf-parse')).default;
      } catch (error) {
        console.error('Failed to load pdf-parse:', error);
        throw new Error('PDF parsing library not available');
      }
    }
    return pdfParse;
  }

  /**
   * Detect actual embedding dimensions
   */
  private async detectEmbeddingDimensions(): Promise<number> {
    if (this.actualVectorSize) {
      return this.actualVectorSize;
    }

    console.log('🔍 Detecting embedding dimensions...');
    const testEmbedding = await this.embeddings.embedQuery("test dimension detection");
    this.actualVectorSize = testEmbedding.length;
    console.log(`📏 Detected embedding dimensions: ${this.actualVectorSize}`);
    
    return this.actualVectorSize;
  }

  /**
   * Test Qdrant connection and health
   */
  private async testQdrantConnection(): Promise<boolean> {
    try {
      console.log('🔍 Testing Qdrant connection...');
      const health = await this.qdrantClient.api('cluster').clusterStatus();
      console.log('✅ Qdrant connection successful');
      return true;
    } catch (error) {
      console.error('❌ Qdrant connection failed:', error);
      return false;
    }
  }

  /**
   * Initialize collection with automatic dimension handling
   */
  async initializeCollection(): Promise<void> {
    try {
      console.log('🚀 Initializing collection with auto-fix...');
      
      // Test Qdrant connection first
      const isQdrantHealthy = await this.testQdrantConnection();
      if (!isQdrantHealthy) {
        throw new Error('Qdrant server is not accessible or healthy');
      }
      
      // First detect the actual embedding dimensions
      const actualDimensions = await this.detectEmbeddingDimensions();
      
      // Check if collection exists
      const collections = await this.qdrantClient.getCollections();
      const existingCollection = collections.collections.find(
        (col) => col.name === this.collectionName
      );

      if (existingCollection) {
        console.log(`📁 Found existing collection: ${this.collectionName}`);
        
        try {
          const collectionInfo = await this.qdrantClient.getCollection(this.collectionName);
          let existingDimensions: number | undefined;
          
          if (collectionInfo.config?.params?.vectors) {
            const vectorsConfig = collectionInfo.config.params.vectors;
            if (typeof vectorsConfig === 'object' && 'size' in vectorsConfig) {
              existingDimensions = vectorsConfig.size as number;
            }
          }

          console.log(`📐 Collection dimensions: ${existingDimensions}, Embedding dimensions: ${actualDimensions}`);

          if (existingDimensions !== actualDimensions) {
            console.log('🔧 DIMENSION MISMATCH DETECTED - Auto-fixing by recreating collection');
            await this.qdrantClient.deleteCollection(this.collectionName);
            await this.createCollectionWithDimensions(actualDimensions);
          } else {
            console.log('✅ Dimensions match, using existing collection');
            
            // Test if collection is actually usable
            const testQuery = await this.testCollectionQuery();
            if (!testQuery) {
              console.log('🔧 Collection exists but not queryable, recreating...');
              await this.qdrantClient.deleteCollection(this.collectionName);
              await this.createCollectionWithDimensions(actualDimensions);
            }
          }
        } catch (error) {
          console.log('⚠️ Could not read existing collection, recreating...');
          await this.qdrantClient.deleteCollection(this.collectionName);
          await this.createCollectionWithDimensions(actualDimensions);
        }
      } else {
        console.log('📝 Creating new collection...');
        await this.createCollectionWithDimensions(actualDimensions);
      }

      // Initialize vector store
      this.vectorStore = new QdrantVectorStore(this.embeddings, {
        client: this.qdrantClient,
        collectionName: this.collectionName,
      });

      console.log('✅ Collection initialized successfully');
    } catch (error) {
      console.error("❌ Error initializing collection:", error);
      throw new Error(`Failed to initialize collection: ${error}`);
    }
  }

  private async testCollectionQuery(): Promise<boolean> {
    try {
      // Try a simple query to test if collection is working
      const result = await this.qdrantClient.query(this.collectionName, {
        vector: Array(this.actualVectorSize || 768).fill(0.1),
        limit: 1,
      });
      return true;
    } catch (error) {
      console.log('Collection query test failed:', error);
      return false;
    }
  }

  private async createCollectionWithDimensions(dimensions: number): Promise<void> {
    console.log(`🏗️ Creating collection with ${dimensions} dimensions`);
    
    await this.qdrantClient.createCollection(this.collectionName, {
      vectors: {
        size: dimensions,
        distance: "Cosine",
      },
      optimizers_config: {
        default_segment_number: 2,
      },
      replication_factor: 1,
    });
    
    // Wait a bit for collection to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(`✅ Created collection: ${this.collectionName} with ${dimensions} dimensions`);
  }

  /**
   * Safe document processing with error recovery
   */
  async processText(text: string, metadata?: Record<string, any>): Promise<void> {
    try {
      console.log('📄 Processing text with auto-fix...');
      
      if (!this.vectorStore) {
        await this.initializeCollection();
      }

      if (!text || text.trim().length === 0) {
        throw new Error("No text content provided");
      }

      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: this.config.chunkSize,
        chunkOverlap: this.config.chunkOverlap,
        separators: ["\n\n", "\n", ". ", " ", ""],
      });

      const chunks = await textSplitter.splitText(text);
      console.log(`📝 Split text into ${chunks.length} chunks`);
      
      const documents = chunks.map((chunk, index) => new Document({
        pageContent: chunk,
        metadata: {
          ...metadata,
          chunkIndex: index,
          chunkId: uuidv4(),
          timestamp: new Date().toISOString(),
          source: metadata?.source || "uploaded_text",
        },
      }));

      // Try to add documents with error recovery
      try {
        console.log('💾 Adding documents to vector store...');
        await this.vectorStore!.addDocuments(documents);
        console.log(`✅ Successfully added ${documents.length} documents`);
        
        // Wait a bit for indexing to complete
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error) {
        if (error instanceof Error && error.message.includes('dimension')) {
          console.log('🔧 Dimension error during document addition, reinitializing...');
          // Reset and reinitialize
          this.vectorStore = null;
          this.actualVectorSize = null;
          await this.initializeCollection();
          
          // Retry document addition
          await this.vectorStore!.addDocuments(documents);
          console.log(`✅ Successfully added ${documents.length} documents after reinitialization`);
          
          // Wait for indexing
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          throw error;
        }
      }

      await this.createRetrievalChain();
      console.log(`🎉 Processed ${documents.length} chunks successfully`);
    } catch (error) {
      console.error("❌ Error processing text:", error);
      throw new Error(`Failed to process text: ${error}`);
    }
  }

  private async createRetrievalChain(): Promise<void> {
    if (!this.vectorStore) {
      throw new Error("Vector store not initialized");
    }

    try {
      const prompt = ChatPromptTemplate.fromTemplate(`
You are a helpful AI assistant. Use the following context to answer the user's question accurately and comprehensively.

Context: {context}

Question: {input}

Instructions:
- Answer based primarily on the provided context
- If the context doesn't contain enough information, clearly state that
- Provide specific details and examples when available
- Answer in detail. 

Answer:`);

      const documentChain = await createStuffDocumentsChain({
        llm: this.llm,
        prompt,
        outputParser: new StringOutputParser(),
      });

      const retriever = this.vectorStore.asRetriever({
        k: 5,
        searchType: "similarity",
      });

      this.retrievalChain = await createRetrievalChain({
        retriever,
        combineDocsChain: documentChain,
      });

      console.log('🔗 Retrieval chain created successfully');
    } catch (error) {
      console.error('❌ Error creating retrieval chain:', error);
      throw new Error(`Failed to create retrieval chain: ${error}`);
    }
  }

  async processPDF(pdfBuffer: Buffer, filename?: string): Promise<void> {
    try {
      console.log(`📄 Processing PDF: ${filename || 'Unknown'}`);
      
      const pdfParseModule = await this.loadPdfParse();
      const pdfData = await pdfParseModule(pdfBuffer);
      const text = pdfData.text;

      if (!text || text.trim().length === 0) {
        throw new Error("No text content found in PDF");
      }

      const metadata = {
        source: filename || "uploaded_pdf",
        type: "pdf",
        pages: pdfData.numpages,
        title: pdfData.info?.Title || filename || "Unknown",
      };

      await this.processText(text, metadata);
      console.log(`✅ PDF processed successfully: ${pdfData.numpages} pages`);
    } catch (error) {
      console.error("❌ Error processing PDF:", error);
      throw new Error(`Failed to process PDF: ${error}`);
    }
  }

  async processFile(file: File): Promise<void> {
    try {
      console.log(`📁 Processing file: ${file.name} (${file.type})`);
      
      const arrayBuffer = await file.arrayBuffer();
      
      if (file.type === "application/pdf") {
        const buffer = Buffer.from(arrayBuffer);
        await this.processPDF(buffer, file.name);
      } else if (file.type === "text/plain" || file.name.endsWith('.txt')) {
        const text = new TextDecoder().decode(arrayBuffer);
        await this.processText(text, {
          source: file.name,
          type: "text",
        });
      } else {
        throw new Error("Unsupported file type. Please upload PDF or TXT files.");
      }
    } catch (error) {
      console.error("❌ Error processing file:", error);
      throw error;
    }
  }

  async askQuestion(question: string): Promise<QAResult> {
    if (!this.retrievalChain || !this.vectorStore) {
      throw new Error("No documents processed yet. Please upload and process a document first.");
    }

    try {
      console.log(`❓ Answering question: ${question}`);
      
      // Test collection first
      const stats = await this.getCollectionStats();
      if (stats.totalPoints === 0) {
        throw new Error("No documents found in the collection. Please upload documents first.");
      }

      console.log(`📊 Collection has ${stats.totalPoints} documents`);
      
      const startTime = Date.now();
      
      // Try similarity search with error handling
      let relevantDocs: Document[] = [];
      try {
        console.log('🔍 Performing similarity search...');
        relevantDocs = await this.vectorStore.similaritySearch(question, 5);
        console.log(`📄 Found ${relevantDocs.length} relevant documents`);
      } catch (searchError) {
        console.error('❌ Similarity search failed:', searchError);
        
        // Try alternative retrieval method
        try {
          console.log('🔄 Trying alternative retrieval...');
          const retriever = this.vectorStore.asRetriever({ k: 5 });
          relevantDocs = await retriever.invoke(question);
          console.log(`📄 Alternative retrieval found ${relevantDocs.length} documents`);
        } catch (altError) {
          console.error('❌ Alternative retrieval also failed:', altError);
          
          // If all retrieval methods fail, try direct query to Qdrant
          try {
            console.log('🔄 Trying direct Qdrant query...');
            const questionEmbedding = await this.embeddings.embedQuery(question);
            const queryResult = await this.qdrantClient.query(this.collectionName, {
              vector: questionEmbedding,
              limit: 5,
              with_payload: true,
            });
            
            relevantDocs = queryResult.points.map(point => new Document({
              pageContent: point.payload?.pageContent as string || "",
              metadata: point.payload?.metadata as Record<string, any> || {},
            }));
            
            console.log(`📄 Direct query found ${relevantDocs.length} documents`);
          } catch (directError) {
            console.error('❌ Direct query failed:', directError);
            throw new Error(`All retrieval methods failed: ${directError}`);
          }
        }
      }
      
      const retrievalTime = Date.now() - startTime;

      if (relevantDocs.length === 0) {
        return {
          answer: "I couldn't find any relevant documents to answer your question. Please make sure documents have been uploaded and processed correctly.",
          sources: [],
          confidence: 0,
          metadata: {
            retrievalTime,
            generationTime: 0,
            chunksUsed: 0,
          },
        };
      }

      const generationStart = Date.now();
      
      // Use the retrieval chain if available, otherwise generate answer manually
      let answer: string;
      try {
        const result = await this.retrievalChain.invoke({ input: question });
        answer = result.answer;
      } catch (chainError) {
        console.error('❌ Retrieval chain failed, generating answer manually:', chainError);
        
        // Manual answer generation
        const context = relevantDocs.map(doc => doc.pageContent).join("\n\n");
        const prompt = `Based on the following context, please answer the question accurately:

Context: ${context}

Question: ${question}

Answer:`;
        
        const response = await this.llm.invoke(prompt);
        answer = typeof response.content === 'string' ? response.content : String(response.content);
      }
      
      const generationTime = Date.now() - generationStart;

      const confidence = this.calculateConfidence(question, relevantDocs);

      console.log(`✅ Question answered in ${retrievalTime + generationTime}ms`);

      return {
        answer,
        sources: relevantDocs,
        confidence,
        metadata: {
          retrievalTime,
          generationTime,
          chunksUsed: relevantDocs.length,
        },
      };
    } catch (error) {
      console.error("❌ Error answering question:", error);
      throw new Error(`Failed to answer question: ${error}`);
    }
  }

  async askQuestionStream(question: string): Promise<AsyncIterable<string>> {
    if (!this.vectorStore) {
      throw new Error("No documents processed yet.");
    }

    console.log(`🌊 Streaming answer for: ${question}`);

    // Try different retrieval methods
    let relevantDocs: Document[] = [];
    
    try {
      relevantDocs = await this.vectorStore.similaritySearch(question, 5);
    } catch (searchError) {
      console.log('Similarity search failed, trying alternative...');
      try {
        const retriever = this.vectorStore.asRetriever({ k: 5 });
        relevantDocs = await retriever.invoke(question);
      } catch (altError) {
        console.log('Alternative retrieval failed, using direct query...');
        const questionEmbedding = await this.embeddings.embedQuery(question);
        const queryResult = await this.qdrantClient.query(this.collectionName, {
          vector: questionEmbedding,
          limit: 5,
          with_payload: true,
        });
        
        relevantDocs = queryResult.points.map(point => new Document({
          pageContent: point.payload?.pageContent as string || "",
          metadata: point.payload?.metadata as Record<string, any> || {},
        }));
      }
    }

    const context = relevantDocs.map(doc => doc.pageContent).join("\n\n");

    const prompt = `
Based on the following context, please answer the question accurately:

Context: ${context}

Question: ${question}

Answer:`;

    const stream = await this.llm.stream(prompt);
    return this.convertStreamToStringIterable(stream);
  }

  private async* convertStreamToStringIterable(
    stream: AsyncIterable<AIMessageChunk>
  ): AsyncIterable<string> {
    for await (const chunk of stream) {
      if (chunk.content && typeof chunk.content === 'string') {
        yield chunk.content;
      } else if (chunk.content) {
        yield String(chunk.content);
      }
    }
  }

  private calculateConfidence(question: string, docs: Document[]): number {
    if (docs.length === 0) return 0;

    const questionWords = question.toLowerCase().split(' ').filter(word => word.length > 3);
    let totalScore = 0;

    for (const doc of docs) {
      const content = doc.pageContent.toLowerCase();
      let docScore = 0;

      if (content.includes(question.toLowerCase())) {
        docScore += 0.4;
      }

      const matchedWords = questionWords.filter(word => content.includes(word));
      docScore += (matchedWords.length / questionWords.length) * 0.3;

      if (doc.pageContent.length > 200) {
        docScore += 0.1;
      }

      totalScore += docScore;
    }

    return Math.min(totalScore / docs.length, 1.0);
  }

  async getCollectionStats(): Promise<{
    totalPoints: number;
    vectorsCount: number;
    collectionName: string;
    isReady: boolean;
    vectorDimensions: number;
  }> {
    try {
      const collectionInfo = await this.qdrantClient.getCollection(this.collectionName);
      
      return {
        totalPoints: collectionInfo.points_count || 0,
        vectorsCount: collectionInfo.vectors_count || 0,
        collectionName: this.collectionName,
        isReady: this.retrievalChain !== null,
        vectorDimensions: this.actualVectorSize || 768,
      };
    } catch (error) {
      console.error('❌ Error getting collection stats:', error);
      return {
        totalPoints: 0,
        vectorsCount: 0,
        collectionName: this.collectionName,
        isReady: false,
        vectorDimensions: this.actualVectorSize || 768,
      };
    }
  }

  async clearDocuments(): Promise<void> {
    try {
      if (this.vectorStore) {
        await this.qdrantClient.deleteCollection(this.collectionName);
        console.log(`🗑️ Deleted collection: ${this.collectionName}`);
      }
      
      this.vectorStore = null;
      this.retrievalChain = null;
      this.actualVectorSize = null;
      
      console.log("✅ Documents cleared successfully");
    } catch (error) {
      console.error("❌ Error clearing documents:", error);
      throw error;
    }
  }
}

export class AutoFixRAGService {
  private ragSystem: AutoFixRAGSystem;
  private isInitialized: boolean = false;

  constructor(
    googleApiKey: string,
    qdrantUrl: string = "http://localhost:6333",
    qdrantApiKey?: string,
    collectionName?: string
  ) {
    if (!googleApiKey) {
      throw new Error('Google API key is required');
    }

    this.ragSystem = new AutoFixRAGSystem({
      googleApiKey,
      qdrantUrl,
      qdrantApiKey,
      collectionName: collectionName || 'rag_documents_collection',
      chunkSize: 1000,
      chunkOverlap: 200,
    });
  }

  async initialize(): Promise<void> {
    if (!this.isInitialized) {
      try {
        await this.ragSystem.initializeCollection();
        this.isInitialized = true;
        console.log('🎉 Auto-Fix RAG Service initialized successfully');
      } catch (error) {
        console.error('❌ Failed to initialize Auto-Fix RAG Service:', error);
        throw error;
      }
    }
  }

  async uploadAndProcess(file: File): Promise<{
    success: boolean;
    message: string;
    stats?: any;
  }> {
    try {
      await this.initialize();
      await this.ragSystem.processFile(file);
      const stats = await this.ragSystem.getCollectionStats();
      
      return {
        success: true,
        message: `Successfully processed ${file.name}`,
        stats,
      };
    } catch (error) {
      console.error('Upload and process error:', error);
      return {
        success: false,
        message: `Error processing file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async queryDocument(question: string): Promise<QAResult | { error: string }> {
    try {
      await this.initialize();
      return await this.ragSystem.askQuestion(question);
    } catch (error) {
      console.error('Query error:', error);
      return { error: `Error querying document: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async streamQuery(question: string): Promise<AsyncIterable<string> | { error: string }> {
    try {
      await this.initialize();
      return await this.ragSystem.askQuestionStream(question);
    } catch (error) {
      console.error('Stream query error:', error);
      return { error: `Error streaming query: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async getStats() {
    try {
      if (!this.isInitialized) {
        return {
          totalPoints: 0,
          vectorsCount: 0,
          collectionName: 'Not initialized',
          isReady: false,
          vectorDimensions: 768,
        };
      }
      return await this.ragSystem.getCollectionStats();
    } catch (error) {
      console.error("Error getting stats:", error);
      return {
        totalPoints: 0,
        vectorsCount: 0,
        collectionName: 'Error',
        isReady: false,
        vectorDimensions: 768,
      };
    }
  }

  async clearAll(): Promise<void> {
    try {
      await this.ragSystem.clearDocuments();
      this.isInitialized = false;
      console.log('RAG Service cleared successfully');
    } catch (error) {
      console.error('Clear error:', error);
      throw error;
    }
  }
}