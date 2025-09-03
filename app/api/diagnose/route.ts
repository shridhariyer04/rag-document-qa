// src/app/api/diagnose/route.ts
import { NextResponse } from 'next/server';
import { DiagnosticRAGService } from '@/lib/diagnostic-rag-service';

export async function GET() {
  try {
    if (!process.env.GOOGLE_API_KEY) {
      return NextResponse.json({
        error: 'GOOGLE_API_KEY not configured'
      }, { status: 500 });
    }

    const diagnostic = new DiagnosticRAGService(
      process.env.GOOGLE_API_KEY,
      process.env.QDRANT_URL || "http://localhost:6333",
      process.env.QDRANT_API_KEY
    );

    const result = await diagnostic.diagnose();
    
    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Diagnostic error:', error);
    return NextResponse.json({
      success: false,
      error: 'Diagnostic failed: ' + (error instanceof Error ? error.message : String(error))
    }, { status: 500 });
  }
}

export async function POST() {
  try {
    if (!process.env.GOOGLE_API_KEY) {
      return NextResponse.json({
        error: 'GOOGLE_API_KEY not configured'
      }, { status: 500 });
    }

    const diagnostic = new DiagnosticRAGService(
      process.env.GOOGLE_API_KEY,
      process.env.QDRANT_URL || "http://localhost:6333",
      process.env.QDRANT_API_KEY
    );

    await diagnostic.forceDeleteCollection();
    
    return NextResponse.json({
      success: true,
      message: 'Collection force deleted'
    });
  } catch (error) {
    console.error('Force delete error:', error);
    return NextResponse.json({
      success: false,
      error: 'Force delete failed: ' + (error instanceof Error ? error.message : String(error))
    }, { status: 500 });
  }
}