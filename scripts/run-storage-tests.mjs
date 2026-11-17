// Node 24 companion for storage-cleanup.test.ts.
//
// Deno is not installed in this environment, so this script supplies the two
// symbols the test file uses from Deno (`Deno.test`) and type-strips both
// modules with Node's built-in TypeScript support before importing them.
//
// Usage: node scripts/run-storage-tests.mjs
//
// It runs the SAME test file the Deno command runs — it does not re-implement
// the assertions.




// No custom loader: Node 24 strips erasable TypeScript natively.

const results = []
globalThis.Deno = {
  test: (name, fn) => {
    results.push([name, fn])
  },
}

const testPath = new URL(
  '../supabase/functions/request-account-deletion/storage-cleanup.test.ts',
  import.meta.url,
).href

await import(testPath)

let pass = 0
let fail = 0
for (const [name, fn] of results) {
  try {
    await fn()
    console.log(`  ok   ${name}`)
    pass++
  } catch (err) {
    console.error(`  FAIL ${name}`)
    console.error(`       ${err?.message ?? err}`)
    fail++
  }
}

console.log(`\n${pass} passed, ${fail} failed, ${results.length} total`)
process.exit(fail === 0 ? 0 : 1)
