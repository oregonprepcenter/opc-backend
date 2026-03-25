import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .limit(5);

    if (error) throw error;

    res.status(200).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
