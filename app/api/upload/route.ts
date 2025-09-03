import { NextRequest, NextResponse } from 'next/server';
import { getRAGService } from '@/lib/shared-rag-service';

export async function POST(request: NextRequest) {
  try {
    const ragService = getRAGService();

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ 
        success: false,
        error: 'No file provided' 
      }, { status: 400 });
    }

    // Check file type
    const allowedTypes = ['application/pdf', 'text/plain'];
    if (!allowedTypes.includes(file.type) && !file.name.endsWith('.txt')) {
      return NextResponse.json({
        success: false,
        error: 'Only PDF and TXT files are supported'
      }, { status: 400 });
    }

    console.log(`Processing file: ${file.name} (${file.type})`);
    
    const result = await ragService.uploadAndProcess(file);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to upload file: ' + (error instanceof Error ? error.message : String(error))
    }, { status: 500 });
  }
}