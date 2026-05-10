import { NextResponse } from 'next/server'

const GONE = {
  error: {
    message: 'This endpoint has been replaced by the workflow engine.',
    code:    'ENDPOINT_REPLACED',
  },
}

export async function GET()   { return NextResponse.json(GONE, { status: 410 }) }
export async function PATCH() { return NextResponse.json(GONE, { status: 410 }) }
export async function POST()  { return NextResponse.json(GONE, { status: 410 }) }
