import { NextRequest, NextResponse } from 'next/server';
import { getRAGService } from '@/lib/shared-rag-service';

export async function POST(request: NextRequest) {
  try {
    const ragService = getRAGService();

    const body = await request.json();
    const { question } = body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      return NextResponse.json({ 
        error: 'Valid question is required' 
      }, { status: 400 });
    }

    console.log(`Processing query: ${question}`);
    
    const result = await ragService.queryDocument(question);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Query error:', error);
    return NextResponse.json({
      error: 'Failed to process query: ' + (error instanceof Error ? error.message : String(error))
    }, { status: 500 });
  }
}