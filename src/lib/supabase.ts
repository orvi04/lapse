import { createClient } from '@supabase/supabase-js'

// Public by design: access is enforced by Row Level Security in the database.
const URL = 'https://cpjoqrkxfqwefjlqyrmu.supabase.co'
const PUBLISHABLE_KEY = 'sb_publishable_ydTbQRGHF7QXuLiyd_RL2A_8SmepJCp'

export const supabase = createClient(URL, PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

export type Profile = {
  id: string
  username: string
  display_name: string
  avatar_path: string | null
  timezone: string | null
}

export type Post = {
  id: string
  author_id: string
  kind: 'solo' | 'coop'
  provenance: 'captured' | 'imported' | 'logged'
  media_id: string | null
  caption: string | null
  focus_seconds: number | null
  blocks_count: number | null
  breaks_count: number | null
  local_date: string
  created_at: string
  feed_expires_at: string
}

export type Promise_ = {
  id: string
  list_id: string
  user_id: string
  position: number
  text: string
  status: 'pending' | 'fulfilled'
  fulfilled_at: string | null
}

export type PromiseList = {
  id: string
  user_id: string
  caption: string | null
  local_date: string
  created_at: string
  feed_expires_at: string
  archived_at: string | null
}

export type Friendship = {
  id: string
  user_low: string
  user_high: string
  requested_by: string
  status: 'pending' | 'accepted'
}
