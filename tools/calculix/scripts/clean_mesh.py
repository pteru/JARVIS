#!/usr/bin/env python3
"""Clean GMSH .inp export for CalculiX: remove 2D surface elements, keep only 3D volume.

GMSH exports Physical Surfaces as CPS3/CPS6 elements which confuse CCX.
This script removes those, keeping only *NODE, C3D* elements, and *ELSET definitions
that reference volume elements.

Usage: python3 clean_mesh.py <input.inp> <output.inp>
"""

import sys
import re


def clean_mesh(input_path, output_path):
    # First pass: identify which element IDs are 3D
    volume_eids = set()
    surface_elsets = set()  # elsets containing 2D elements
    volume_elsets = set()

    with open(input_path) as f:
        current_type = None
        current_elset = None
        for line in f:
            stripped = line.strip()
            if stripped.upper().startswith('*ELEMENT'):
                m_type = re.search(r'TYPE\s*=\s*(\S+)', stripped, re.IGNORECASE)
                m_set = re.search(r'ELSET\s*=\s*(\S+)', stripped, re.IGNORECASE)
                current_type = m_type.group(1).upper() if m_type else None
                current_elset = m_set.group(1).upper() if m_set else None
                if current_type and current_type.startswith('C3D'):
                    volume_elsets.add(current_elset)
                elif current_type:
                    surface_elsets.add(current_elset)
                continue
            if stripped.startswith('*') and not stripped.startswith('**'):
                current_type = None
                current_elset = None
                continue
            if current_type and current_type.startswith('C3D'):
                parts = stripped.rstrip(',').split(',')
                if parts[0].strip().isdigit():
                    volume_eids.add(int(parts[0].strip()))

    print(f"Volume elements: {len(volume_eids)}")
    print(f"Volume elsets: {volume_elsets}")
    print(f"Surface elsets (removed): {surface_elsets}")

    # Second pass: write clean file
    with open(input_path) as fin, open(output_path, 'w') as fout:
        skip_section = False
        current_type = None
        in_elset = False
        elset_name = None

        for line in fin:
            stripped = line.strip()

            # Keyword line
            if stripped.startswith('*') and not stripped.startswith('**'):
                upper = stripped.upper()

                if upper.startswith('*ELEMENT'):
                    m_type = re.search(r'TYPE\s*=\s*(\S+)', upper)
                    current_type = m_type.group(1) if m_type else None
                    if current_type and current_type.startswith('C3D'):
                        skip_section = False
                        fout.write(line)
                    else:
                        skip_section = True
                    in_elset = False
                    continue

                elif upper.startswith('*ELSET'):
                    m_set = re.search(r'ELSET\s*=\s*(\S+)', upper)
                    elset_name = m_set.group(1).upper() if m_set else None
                    if elset_name in surface_elsets:
                        skip_section = True
                        in_elset = False
                    else:
                        skip_section = False
                        in_elset = True
                        fout.write(line)
                    current_type = None
                    continue

                else:
                    skip_section = False
                    in_elset = False
                    current_type = None
                    fout.write(line)
                    continue

            # Data line
            if not skip_section:
                fout.write(line)

    print(f"Clean mesh written to: {output_path}")


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <input.inp> <output.inp>")
        sys.exit(1)
    clean_mesh(sys.argv[1], sys.argv[2])
