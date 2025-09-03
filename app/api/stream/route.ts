// src/app/api/stream/route.ts
import { NextRequest } from 'next/server';
import { getRAGService } from '@/lib/shared-rag-service';

export async function POST(request: NextRequest) {
  try {
    const ragService = getRAGService();

    const body = await request.json();
    const { question } = body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      return new Response('Valid question is required', { status: 400 });
    }

    console.log(`Processing stream query: ${question}`);

    const streamResult = await ragService.streamQuery(question);

    if ('error' in streamResult) {
      return new Response(streamResult.error, { status: 500 });
    }

    const encoder = new TextEncoder();
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamResult as AsyncIterable<string>) {
            const encodedChunk = encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`);
            controller.enqueue(encodedChunk);
          }
          
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
        } catch (error) {
          console.error('Stream error:', error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Stream setup error:', error);
    return new Response('Internal server error: ' + (error instanceof Error ? error.message : String(error)), { status: 500 });
  }
}