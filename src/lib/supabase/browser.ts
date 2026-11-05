'use client';
import { createBrowserClient } from '@supabase/ssr';
import { supabaseUrl, supabaseKey, configured } from './config';
export function browserClient() { if (!configured) throw new Error('Сервіс тимчасово недоступний.'); return createBrowserClient(supabaseUrl, supabaseKey); }
