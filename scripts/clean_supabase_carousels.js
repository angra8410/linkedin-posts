import { pool } from '../server/db.js';

async function runCleanup() {
  const isExecute = process.argv.includes('--execute');
  
  console.log('----------------------------------------------------');
  console.log('  POSTGRES DRAFTS CAROUSEL CLEANUP & SLIMSCRIPT     ');
  console.log('----------------------------------------------------');
  console.log(`Mode: ${isExecute ? 'EXECUTE (Updating Database)' : 'DRY RUN (Read Only)'}`);
  console.log('Fetching drafts...');

  try {
    const { rows: drafts } = await pool.query('SELECT id, data, updated_at FROM drafts');

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

        try {
          await pool.query(
            `INSERT INTO drafts (id, data, updated_at) VALUES ($1, $2, NOW())
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
            [draft.id, JSON.stringify(draft.data)]
          );
          successCount += 1;
        } catch (upsertError) {
          console.error(`  ❌ Failed for ${draft.id}:`, upsertError.message);
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
      process.exit(0);
    });

  } catch (err) {
    console.error('Fatal error during cleanup execution:', err.message);
  }
}

runCleanup();
