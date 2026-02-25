#!/usr/bin/env python3
"""Extract node sets from GMSH-exported CalculiX .inp mesh file.

GMSH exports Physical Surfaces as 2D element sets (CPS6/CPS3).
This script reads those surface elements and creates *NSET definitions
containing all nodes referenced by those elements.

Usage: python3 extract_nsets.py <mesh.inp> <output.inp>
"""

import sys
import re
from collections import defaultdict


def parse_mesh(filepath):
    """Parse GMSH .inp file and extract surface element sets."""
    nodes = {}
    elements_by_set = defaultdict(list)
    volume_elements = []
    all_nodes_section = []
    current_section = None
    current_elset = None
    element_type = None

    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('**'):
                if line.startswith('**'):
                    continue
                continue

            if line.startswith('*') and not line[1].isdigit():
                upper = line.upper()
                if upper.startswith('*NODE'):
                    current_section = 'NODE'
                    current_elset = None
                    continue
                elif upper.startswith('*ELEMENT'):
                    current_section = 'ELEMENT'
                    # Parse type and elset
                    m_type = re.search(r'TYPE\s*=\s*(\S+)', upper)
                    m_set = re.search(r'ELSET\s*=\s*(\S+)', upper)
                    element_type = m_type.group(1) if m_type else None
                    current_elset = m_set.group(1) if m_set else None
                    continue
                elif upper.startswith('*ELSET'):
                    current_section = 'ELSET'
                    m_set = re.search(r'ELSET\s*=\s*(\S+)', upper)
                    current_elset = m_set.group(1) if m_set else None
                    continue
                else:
                    current_section = None
                    current_elset = None
                    continue

            if current_section == 'NODE':
                parts = line.rstrip(',').split(',')
                nid = int(parts[0])
                coords = [float(x) for x in parts[1:4]]
                nodes[nid] = coords
                all_nodes_section.append(line)

            elif current_section == 'ELEMENT' and current_elset:
                parts = [int(x) for x in line.rstrip(',').split(',') if x.strip()]
                eid = parts[0]
                enodes = parts[1:]
                if element_type and element_type.startswith('C3D'):
                    volume_elements.append((element_type, current_elset, eid, enodes))
                else:
                    elements_by_set[current_elset].append(enodes)

            elif current_section == 'ELSET' and current_elset:
                parts = [int(x) for x in line.rstrip(',').split(',') if x.strip()]
                # These reference element IDs — skip for now, we use surface elements directly

    return nodes, elements_by_set, volume_elements


def build_nsets(elements_by_set):
    """Build node sets from surface element connectivity."""
    nsets = {}
    for setname, elem_list in elements_by_set.items():
        node_ids = set()
        for enodes in elem_list:
            node_ids.update(enodes)
        nsets[setname] = sorted(node_ids)
    return nsets


def write_nsets(nsets, output_path):
    """Write *NSET definitions to a file."""
    with open(output_path, 'w') as f:
        f.write("** Node sets extracted from GMSH surface elements\n")
        f.write("**\n")
        for setname, node_ids in sorted(nsets.items()):
            f.write(f"*NSET, NSET=N{setname}\n")
            # Write 10 node IDs per line
            for i in range(0, len(node_ids), 10):
                chunk = node_ids[i:i+10]
                line = ", ".join(str(n) for n in chunk)
                if i + 10 < len(node_ids):
                    line += ","
                f.write(line + "\n")
            f.write("**\n")
        print(f"Written {len(nsets)} node sets to {output_path}")
        for name, nids in sorted(nsets.items()):
            print(f"  N{name}: {len(nids)} nodes")


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <mesh.inp> <nsets_output.inp>")
        sys.exit(1)

    mesh_file = sys.argv[1]
    output_file = sys.argv[2]

    print(f"Parsing: {mesh_file}")
    nodes, elements_by_set, volume_elements = parse_mesh(mesh_file)
    print(f"  Nodes: {len(nodes)}")
    print(f"  Volume elements: {len(volume_elements)}")
    print(f"  Surface element sets: {list(elements_by_set.keys())}")

    nsets = build_nsets(elements_by_set)
    write_nsets(nsets, output_file)
