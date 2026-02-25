// Cantilever Beam - GMSH geometry file
// 200mm x 20mm x 10mm steel beam

// Parameters
L = 200;   // length (mm)
W = 20;    // width (mm)
H = 10;    // height (mm)
mesh_size = 3;  // element size (mm)

// Points
Point(1) = {0, 0, 0, mesh_size};
Point(2) = {L, 0, 0, mesh_size};
Point(3) = {L, W, 0, mesh_size};
Point(4) = {0, W, 0, mesh_size};
Point(5) = {0, 0, H, mesh_size};
Point(6) = {L, 0, H, mesh_size};
Point(7) = {L, W, H, mesh_size};
Point(8) = {0, W, H, mesh_size};

// Lines - bottom face
Line(1) = {1, 2};
Line(2) = {2, 3};
Line(3) = {3, 4};
Line(4) = {4, 1};

// Lines - top face
Line(5) = {5, 6};
Line(6) = {6, 7};
Line(7) = {7, 8};
Line(8) = {8, 5};

// Lines - vertical edges
Line(9)  = {1, 5};
Line(10) = {2, 6};
Line(11) = {3, 7};
Line(12) = {4, 8};

// Surfaces
Curve Loop(1) = {1, 2, 3, 4};       // bottom
Plane Surface(1) = {1};
Curve Loop(2) = {5, 6, 7, 8};       // top
Plane Surface(2) = {2};
Curve Loop(3) = {1, 10, -5, -9};    // front
Plane Surface(3) = {3};
Curve Loop(4) = {2, 11, -6, -10};   // right (free end)
Plane Surface(4) = {4};
Curve Loop(5) = {3, 12, -7, -11};   // back
Plane Surface(5) = {5};
Curve Loop(6) = {4, 9, -8, -12};    // left (fixed end)
Plane Surface(6) = {6};

// Volume
Surface Loop(1) = {1, 2, 3, 4, 5, 6};
Volume(1) = {1};

// Physical groups
Physical Volume("BEAM") = {1};
Physical Surface("FIXED") = {6};      // fixed end (x=0)
Physical Surface("LOAD_FACE") = {4};  // free end (x=L) for bearing load

// Mesh with second-order tetrahedra (C3D10)
Mesh.ElementOrder = 2;
Mesh.Algorithm3D = 1;  // Delaunay
