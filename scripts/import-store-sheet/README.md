# Import the store sheet

Turns the NIMR FU Goa store spreadsheet (exported as CSV) into one SQL script
for the Supabase SQL Editor.

```bash
python3 scripts/import-store-sheet/csv_to_sql.py "NIMR_FUG_Store_stock.csv" import_store_sheet.sql
```

Then paste `import_store_sheet.sql` into Supabase → SQL Editor → Run.

What it does, in one transaction:

1. Creates the low-stock view (migration 5) if it is not there yet.
2. Stops if the catalog already has items (it is for a first load).
3. Creates categories from the sheet's own groups (O-1 Stationery, O-2
   Electronic …); sections without a group become "Lab supplies" or
   "General store".
4. Creates one location per "Location of the Item", with cleaned names.
5. Creates one catalog item per distinct name + description; the same item in
   several places gets stock in each place.
6. Records "Stock Quantity" as received and "No. of Item Issued" as issued
   before go-live, so balances equal the sheet's "Balance Item".
7. Checks every balance against the sheet and rolls everything back on any
   mismatch.

The CSV itself is not committed: it is operational data.
