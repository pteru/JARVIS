---
name: xlsx
description: Work with Excel (.xlsx) files — create, read, edit, and inspect spreadsheets
argument-hint: "[subcommand] [file]"
---

# XLSX Tool

A CLI tool for working with Excel files. Always invoke via the dedicated venv:

```
XLSX="/home/teruel/JARVIS/tools/.venv/bin/python /home/teruel/JARVIS/tools/xlsx-tool.py"
```

## Subcommands

### Read data
```bash
$XLSX read file.xlsx                              # Print all data as table
$XLSX read file.xlsx --format json                # Output as JSON
$XLSX read file.xlsx --sheet Sheet2 --range A1:D10  # Specific sheet and range
$XLSX read file.xlsx --with-styles --format json  # Include fill colors, fonts, borders, merged cells
```

### Create from JSON
```bash
# From list of objects (keys become headers):
echo '[{"Name":"Widget","Price":9.99},{"Name":"Gadget","Price":19.99}]' | $XLSX create output.xlsx

# From list of lists (raw rows):
echo '[["Name","Price"],["Widget",9.99]]' | $XLSX create output.xlsx

# From file:
$XLSX create output.xlsx -i data.json

# With custom sheet name:
$XLSX create output.xlsx --sheet "Sales Data"
```

### Edit cells
```bash
$XLSX edit file.xlsx --set A1=Hello --set B2=42   # Set cell values
$XLSX edit file.xlsx --insert-row 3               # Insert row at position 3
$XLSX edit file.xlsx --delete-row 5               # Delete row 5
$XLSX edit file.xlsx --rename "New Sheet Name"    # Rename active sheet
$XLSX edit file.xlsx --sheet Sheet2 --set A1=Test # Edit specific sheet
```

### Inspect file
```bash
$XLSX info file.xlsx   # List sheets, dimensions, column headers
```

## Common Patterns

**Read → transform → write:**
```bash
data=$($XLSX read input.xlsx --format json)
echo "$data" | python3 -c "
import json, sys
rows = json.load(sys.stdin)['rows']
# ... transform ...
json.dump(transformed, sys.stdout)
" | $XLSX create output.xlsx
```

**Interpret a Gantt chart:**
```bash
$XLSX read gantt.xlsx --with-styles --format json
# Colored cells indicate task durations; check style.fill for color coding
```
