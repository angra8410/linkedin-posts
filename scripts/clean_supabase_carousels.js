import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import readline from 'readline';

// 1. Read environmental variables from workspace root .env file
const envPath = './.env';
if (!fs.existsSync(envPath)) {
  console.error('Error: .env file not found in the workspace root.');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const getEnvVar = (key) => {
  const match = envContent.match(new RegExp(`${key}\\s*=\\s*["']?([^"'\r\n]+)["']?`));
  return match ? match[1] : null;
};

const supabaseUrl = getEnvVar('SUPABASE_URL');
const supabaseKey = getEnvVar('SUPABASE_SERVICE_KEY');

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env file.');
  process.exit(1);
}

// 2. Initialize Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

async function runCleanup() {
  const isExecute = process.argv.includes('--execute');
  
  console.log('----------------------------------------------------');
  console.log('  SUPABASE DRAFTS CAROUSEL CLEANUP & SLIMSCRIPT  ');
  console.log('----------------------------------------------------');
  console.log(`Connecting to: ${supabaseUrl}`);
  console.log(`Mode: ${isExecute ? 'EXECUTE (Updating Database)' : 'DRY RUN (Read Only)'}`);
  console.log('Fetching drafts...');

  try {
    const { data: drafts, error } = await supabase
      .from('drafts')
      .select('id, data, updated_at');

    if (error) throw error;

    if (!drafts || drafts.length === 0) {
      console.log('No drafts found in database.');
      return;
    }

    let affectedCount = 0;
    let totalBytesSaved = 0;
    const draftsToUpdate = [];

    drafts.forEach(row => {
      const draftData = row.data || {};
      if (draftData.carouselSlides && Array.isArray(draftData.carouselSlides)) {
        affectedCount += 1;
        
        // Estimate saved storage space (JSON character length)
        const sizeBefore = JSON.stringify(draftData).length;
        
        // Clone and delete the heavy slides property
        const cleanedData = { ...draftData };
        delete cleanedData.carouselSlides;
        
        const sizeAfter = JSON.stringify(cleanedData).length;
        const savedBytes = sizeBefore - sizeAfter;
        totalBytesSaved += savedBytes;

        draftsToUpdate.push({
          id: row.id,
          data: cleanedData,
          updated_at: new Date().toISOString()
        });
      }
    });

    console.log(`\nScan Complete:`);
    console.log(`- Total drafts in database: ${drafts.length}`);
    console.log(`- Drafts containing carousel slides: ${affectedCount}`);
    console.log(`- Estimated database space to save: ${(totalBytesSaved / 1024).toFixed(2)} KB (~${(totalBytesSaved / 1024 / 1024).toFixed(2)} MB)`);

    if (affectedCount === 0) {
      console.log('\nNo drafts need cleaning. Database is already slim!');
      return;
    }

    if (!isExecute) {
      console.log('\n[Dry Run Info]: No updates were written. To apply changes, run:');
      console.log('  npm run db:clean-carousels -- --execute');
      return;
    }

    const skipPrompt = process.argv.includes('--yes');

    const proceedWithUpdate = async () => {
      console.log('\nApplying updates sequentially...');
      let successCount = 0;

      for (const draft of draftsToUpdate) {
        console.log(`- Cleaning draft ID: ${draft.id}...`);
        const { error: upsertError } = await supabase
          .from('drafts')
          .upsert(draft);

        if (upsertError) {
          console.error(`  ❌ Failed for ${draft.id}:`, upsertError.message);
        } else {
          successCount += 1;
        }
      }

      console.log(`\n🎉 Success! Cleaned ${successCount}/${affectedCount} drafts in Supabase.`);
      console.log('Egress consumption is now minimized. Loading your drafts will be virtually instantaneous.');
    };

    if (skipPrompt) {
      await proceedWithUpdate();
      return;
    }

    // Interactive confirmation in console
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(`\n⚠️  WARNING: You are about to permanently delete slides data from ${affectedCount} drafts. Proceed? (y/N): `, async (answer) => {
      rl.close();
      if (answer.toLowerCase() !== 'y') {
        console.log('Operation cancelled. No database changes were made.');
        process.exit(0);
      }
      await proceedWithUpdate();
    });

  } catch (err) {
    console.error('Fatal error during cleanup execution:', err.message);
  }
}

runCleanup();
