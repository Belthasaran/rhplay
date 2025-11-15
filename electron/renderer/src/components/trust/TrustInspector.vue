<template>
  <div class="trust-inspector">
    <div class="inspector-header">
      <h4>Trust Inspector</h4>
      <p class="admin-note">Visualize trust relationships, delegation chains, and trust graphs for any public key.</p>
    </div>

    <div class="inspector-controls">
      <div class="control-group">
        <label>
          Inspect Public Key
          <input
            v-model.trim="inspectedPubkey"
            type="text"
            placeholder="npub… or hex"
            @keyup.enter="loadTrustGraph"
          />
        </label>
        <button class="btn-primary" @click="loadTrustGraph" :disabled="loading || !inspectedPubkey">
          {{ loading ? 'Loading…' : 'Inspect' }}
        </button>
      </div>
      <div class="control-group">
        <label>
          <input
            v-model="showDelegationChains"
            type="checkbox"
          />
          Show Delegation Chains
        </label>
        <label>
          <input
            v-model="showTrustGraph"
            type="checkbox"
          />
          Show Trust Graph
        </label>
      </div>
    </div>

    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <div v-if="loading" class="loading-message">
      Loading trust data…
    </div>

    <div v-else-if="trustData" class="inspector-content">
      <!-- Overview Section -->
      <section class="overview-section">
        <h5>Overview</h5>
        <div class="overview-grid">
          <div>
            <label>Public Key</label>
            <code class="mono">{{ inspectedPubkey }}</code>
          </div>
          <div>
            <label>Trust Level</label>
            <span class="trust-value">{{ trustData.trust_level ?? 'n/a' }}</span>
          </div>
          <div>
            <label>Trust Tier</label>
            <span :class="['trust-badge', `tier-${(trustData.trust_tier || 'unknown').toLowerCase()}`]">
              {{ (trustData.trust_tier || 'unknown').toUpperCase() }}
            </span>
          </div>
          <div>
            <label>Admin Level</label>
            <span class="trust-value">{{ trustData.admin_level ?? 'n/a' }}</span>
          </div>
        </div>
      </section>

      <!-- Delegation Chains Section -->
      <section v-if="showDelegationChains && delegationChains.length > 0" class="delegation-chains-section">
        <h5>Delegation Chains</h5>
        <div class="chains-container">
          <div
            v-for="(chain, chainIndex) in delegationChains"
            :key="chainIndex"
            class="delegation-chain"
          >
            <div class="chain-header">
              <strong>Chain {{ chainIndex + 1 }}</strong>
              <span class="chain-length">{{ chain.length }} delegation(s)</span>
            </div>
            <div class="chain-path">
              <div
                v-for="(link, linkIndex) in chain"
                :key="linkIndex"
                class="chain-link"
              >
                <div class="link-node">
                  <code class="mono">{{ formatPubkey(link.issuer) }}</code>
                  <span class="link-arrow">→</span>
                  <code class="mono">{{ formatPubkey(link.subject) }}</code>
                </div>
                <div class="link-details">
                  <span class="trust-level-badge">{{ link.trust_level || 'N/A' }}</span>
                  <span v-if="link.scope" class="scope-badge">{{ formatScope(link.scope) }}</span>
                  <span v-if="link.permissions" class="perms-badge">
                    {{ Object.keys(link.permissions).filter(k => link.permissions[k]).length }} permission(s)
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Trust Graph Visualization -->
      <section v-if="showTrustGraph && trustGraph.nodes.length > 0" class="trust-graph-section">
        <div class="graph-section-header">
          <h5>Trust Graph</h5>
          <div class="graph-header-controls">
            <label>
              <input
                v-model="graphLayoutMode"
                type="radio"
                value="force"
              />
              Force-Directed
            </label>
            <label>
              <input
                v-model="graphLayoutMode"
                type="radio"
                value="hierarchical"
              />
              Hierarchical
            </label>
            <label>
              <input
                v-model="graphLayoutMode"
                type="radio"
                value="circular"
              />
              Circular
            </label>
            <label>
              <input
                v-model="showEdgeLabels"
                type="checkbox"
              />
              Show Edge Labels
            </label>
            <label>
              <input
                v-model="showFullScreenGraph"
                type="checkbox"
              />
              Full Screen
            </label>
          </div>
        </div>
        <div class="graph-controls">
          <button class="btn-secondary" @click="resetGraphView">Reset View</button>
          <button class="btn-secondary" @click="zoomIn">Zoom In</button>
          <button class="btn-secondary" @click="zoomOut">Zoom Out</button>
          <button class="btn-secondary" @click="centerGraph">Center</button>
          <button class="btn-secondary" @click="applyLayout">Apply Layout</button>
          <button class="btn-secondary" @click="expandSelectedNode" :disabled="!selectedNode">
            Expand Node
          </button>
        </div>
        <div 
          ref="graphContainer" 
          class="graph-container"
          :class="{ 'fullscreen': showFullScreenGraph }"
        >
          <svg
            :width="graphWidth"
            :height="graphHeight"
            class="trust-graph-svg"
            @mousedown="handleMouseDown"
            @mousemove="handleMouseMove"
            @mouseup="handleMouseUp"
            @wheel.prevent="handleWheel"
            @contextmenu.prevent="handleContextMenu"
          >
            <!-- Background grid -->
            <defs>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e0e0e0" stroke-width="0.5"/>
              </pattern>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" fill="#999" />
              </marker>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
            
            <!-- Edges (trust relationships) -->
            <g class="edges">
              <g
                v-for="edge in trustGraph.edges"
                :key="`${edge.from}-${edge.to}`"
                class="edge-group"
                :class="{ 
                  'highlighted': highlightedNode === edge.from || highlightedNode === edge.to,
                  'selected-path': isEdgeInSelectedPath(edge)
                }"
              >
                <line
                  :x1="getNodeX(edge.from)"
                  :y1="getNodeY(edge.from)"
                  :x2="getNodeX(edge.to)"
                  :y2="getNodeY(edge.to)"
                  class="edge"
                  :stroke-width="getEdgeWidth(edge)"
                  @mouseenter="highlightedEdge = edge"
                  @mouseleave="highlightedEdge = null"
                />
                <text
                  v-if="showEdgeLabels && getEdgeLabel(edge)"
                  :x="(getNodeX(edge.from) + getNodeX(edge.to)) / 2"
                  :y="(getNodeY(edge.from) + getNodeY(edge.to)) / 2 - 5"
                  class="edge-label"
                  text-anchor="middle"
                >
                  {{ getEdgeLabel(edge) }}
                </text>
              </g>
            </g>
            
            <!-- Nodes (public keys) -->
            <g class="nodes">
              <g
                v-for="node in trustGraph.nodes"
                :key="node.id"
                :transform="`translate(${getNodeX(node.id)}, ${getNodeY(node.id)})`"
                class="node-group"
                :class="{
                  'highlighted': highlightedNode === node.id,
                  'selected': selectedNode === node.id,
                  'inspected': node.id === inspectedPubkey,
                  'expanded': expandedNodes.has(node.id)
                }"
                @mouseenter="handleNodeHover(node.id)"
                @mouseleave="handleNodeLeave"
                @click="selectNode(node.id)"
                @dblclick="expandNode(node.id)"
              >
                <!-- Node circle with glow effect -->
                <circle
                  :r="node.radius"
                  class="node-glow"
                  :fill="getNodeColor(node)"
                  opacity="0.3"
                />
                <circle
                  :r="node.radius"
                  :class="['node', { 'selected': selectedNode === node.id, 'inspected': node.id === inspectedPubkey }]"
                  :fill="getNodeColor(node)"
                />
                <!-- Node icon/indicator -->
                <circle
                  v-if="node.id === inspectedPubkey"
                  r="4"
                  fill="white"
                  class="node-center"
                />
                <!-- Node label background -->
                <rect
                  v-if="showNodeLabels"
                  x="-40"
                  y="25"
                  width="80"
                  height="30"
                  rx="4"
                  class="node-label-bg"
                />
                <text
                  v-if="showNodeLabels"
                  y="40"
                  text-anchor="middle"
                  class="node-label"
                >
                  {{ formatPubkey(node.id) }}
                </text>
                <text
                  v-if="showNodeLabels"
                  y="55"
                  text-anchor="middle"
                  class="node-trust-level"
                >
                  {{ node.trust_level || 'N/A' }}
                </text>
              </g>
            </g>
            
            <!-- Tooltip -->
            <g
              v-if="tooltipNode"
              :transform="`translate(${tooltipX}, ${tooltipY})`"
              class="tooltip-group"
            >
              <rect
                x="-80"
                y="-50"
                width="160"
                height="80"
                rx="4"
                class="tooltip-bg"
              />
              <text y="-30" text-anchor="middle" class="tooltip-title">
                {{ formatPubkey(tooltipNode.id) }}
              </text>
              <text y="-15" text-anchor="middle" class="tooltip-text">
                Trust Level: {{ tooltipNode.trust_level || 'N/A' }}
              </text>
              <text y="0" text-anchor="middle" class="tooltip-text">
                Tier: {{ tooltipNode.trust_tier || 'N/A' }}
              </text>
              <text y="15" text-anchor="middle" class="tooltip-text">
                Connections: {{ getNodeConnectionCount(tooltipNode.id) }}
              </text>
            </g>
          </svg>
        </div>
        
        <!-- Graph Legend -->
        <div class="graph-legend">
          <div class="legend-item">
            <div class="legend-color inspected"></div>
            <span>Inspected Key</span>
          </div>
          <div class="legend-item">
            <div class="legend-color selected"></div>
            <span>Selected</span>
          </div>
          <div class="legend-item">
            <div class="legend-color trusted"></div>
            <span>Trusted</span>
          </div>
          <div class="legend-item">
            <div class="legend-color verified"></div>
            <span>Verified</span>
          </div>
          <div class="legend-item">
            <div class="legend-color default"></div>
            <span>Other</span>
          </div>
        </div>
        
        <div v-if="selectedNode" class="node-details">
          <div class="node-details-header">
            <h6>Selected Node Details</h6>
            <button class="btn-link" @click="selectedNode = null">Clear</button>
          </div>
          <div class="details-grid">
            <div>
              <label>Public Key</label>
              <code class="mono">{{ selectedNode }}</code>
            </div>
            <div>
              <label>Trust Level</label>
              <span>{{ getNodeData(selectedNode)?.trust_level || 'N/A' }}</span>
            </div>
            <div>
              <label>Trust Tier</label>
              <span>{{ getNodeData(selectedNode)?.trust_tier || 'N/A' }}</span>
            </div>
            <div>
              <label>Connections</label>
              <span>{{ getNodeConnectionCount(selectedNode) }} ({{ getIncomingCount(selectedNode) }} in, {{ getOutgoingCount(selectedNode) }} out)</span>
            </div>
          </div>
          <div class="node-actions">
            <button class="btn-secondary" @click="expandNode(selectedNode)">Expand Connections</button>
            <button class="btn-secondary" @click="inspectNode(selectedNode)">Inspect This Key</button>
            <button class="btn-secondary" @click="highlightPath(selectedNode)">Highlight Path</button>
          </div>
        </div>
      </section>

      <!-- Trust Sources Section -->
      <section v-if="trustData.declarations?.length || trustData.assignments?.length" class="trust-sources-section">
        <h5>Trust Sources</h5>
        <div class="sources-tabs">
          <button
            :class="['tab-button', { active: sourcesTab === 'declarations' }]"
            @click="sourcesTab = 'declarations'"
          >
            Declarations ({{ trustData.declarations?.length || 0 }})
          </button>
          <button
            :class="['tab-button', { active: sourcesTab === 'assignments' }]"
            @click="sourcesTab = 'assignments'"
          >
            Assignments ({{ trustData.assignments?.length || 0 }})
          </button>
        </div>
        <div v-if="sourcesTab === 'declarations'" class="sources-content">
          <div
            v-for="decl in trustData.declarations"
            :key="decl.declaration_uuid"
            class="source-item"
          >
            <div class="source-header">
              <code class="mono">{{ decl.declaration_uuid }}</code>
              <span class="status-chip">{{ decl.status || 'Draft' }}</span>
            </div>
            <div class="source-details">
              <div>Issuer: <code class="mono">{{ formatPubkey(decl.issuing_fingerprint || decl.issuing_keypair_fingerprint) }}</code></div>
              <div>Trust Level: {{ extractTrustLevel(decl) || 'N/A' }}</div>
              <div v-if="extractScope(decl)">Scope: {{ extractScope(decl) }}</div>
            </div>
          </div>
        </div>
        <div v-else-if="sourcesTab === 'assignments'" class="sources-content">
          <div
            v-for="assignment in trustData.assignments"
            :key="assignment.assignment_id"
            class="source-item"
          >
            <div class="source-header">
              <code class="mono">Assignment #{{ assignment.assignment_id }}</code>
            </div>
            <div class="source-details">
              <div>Assigned By: <code class="mono">{{ formatPubkey(assignment.assigned_by_pubkey) }}</code></div>
              <div>Level: {{ assignment.assigned_trust_level ?? 'N/A' }}</div>
              <div v-if="assignment.scope">Scope: {{ formatScope(assignment.scope) }}</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';

type TrustData = {
  pubkey: string;
  trust_level?: number | null;
  trust_tier?: string | null;
  admin_level?: number | null;
  declarations?: Array<any>;
  assignments?: Array<any>;
};

type DelegationChain = Array<{
  issuer: string;
  subject: string;
  trust_level?: string | null;
  scope?: any;
  permissions?: Record<string, any>;
}>;

type GraphNode = {
  id: string;
  trust_level?: number | null;
  trust_tier?: string | null;
  radius: number;
  x?: number;
  y?: number;
};

type GraphEdge = {
  from: string;
  to: string;
};

type TrustGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

const props = defineProps<{
  initialPubkey?: string | null;
}>();

const inspectedPubkey = ref(props.initialPubkey || '');
const loading = ref(false);
const error = ref<string | null>(null);
const trustData = ref<TrustData | null>(null);
const showDelegationChains = ref(true);
const showTrustGraph = ref(true);
const sourcesTab = ref<'declarations' | 'assignments'>('declarations');

const delegationChains = ref<DelegationChain[]>([]);
const trustGraph = reactive<TrustGraph>({
  nodes: [],
  edges: []
});

const graphContainer = ref<HTMLElement | null>(null);
const graphWidth = ref(800);
const graphHeight = ref(600);
const graphZoom = ref(1);
const graphPanX = ref(0);
const graphPanY = ref(0);
const isDragging = ref(false);
const dragStart = ref({ x: 0, y: 0 });
const highlightedNode = ref<string | null>(null);
const selectedNode = ref<string | null>(null);
const highlightedEdge = ref<GraphEdge | null>(null);
const tooltipNode = ref<GraphNode | null>(null);
const tooltipX = ref(0);
const tooltipY = ref(0);
const showNodeLabels = ref(true);
const showEdgeLabels = ref(false);
const showFullScreenGraph = ref(false);
const graphLayoutMode = ref<'force' | 'hierarchical' | 'circular'>('force');
const expandedNodes = reactive(new Set<string>());
const selectedPath = ref<string[]>([]);
const edgeData = reactive(new Map<string, { trust_level?: string; scope?: any }>());

watch(() => props.initialPubkey, (newPubkey) => {
  if (newPubkey) {
    inspectedPubkey.value = newPubkey;
    loadTrustGraph();
  }
});

async function loadTrustGraph() {
  if (!inspectedPubkey.value.trim()) {
    error.value = 'Please enter a public key to inspect';
    return;
  }

  loading.value = true;
  error.value = null;

  try {
    const api = (window as any)?.electronAPI;
    if (!api?.getTrustPermissions) {
      throw new Error('Trust permissions API not available');
    }

    const response = await api.getTrustPermissions(inspectedPubkey.value);
    if (!response || response.success === false) {
      throw new Error(response?.error || 'Failed to load trust data');
    }

    trustData.value = response as TrustData;
    buildDelegationChains(response);
    buildTrustGraph(response);
  } catch (err: any) {
    error.value = err?.message || String(err);
    trustData.value = null;
    delegationChains.value = [];
    trustGraph.nodes = [];
    trustGraph.edges = [];
  } finally {
    loading.value = false;
  }
}

function buildDelegationChains(data: TrustData) {
  const chains: DelegationChain[] = [];
  
  if (!data.declarations) {
    delegationChains.value = chains;
    return;
  }

  // Build chains from declarations
  // This is a simplified version - in a real implementation, you'd traverse
  // the full graph to find all possible chains
  data.declarations.forEach((decl) => {
    const issuer = decl.issuing_fingerprint || decl.issuing_keypair_fingerprint || '';
    const subject = decl.target_fingerprint || decl.target_keypair_fingerprint || inspectedPubkey.value;
    
    if (issuer && subject) {
      chains.push([{
        issuer,
        subject,
        trust_level: extractTrustLevel(decl),
        scope: extractScopeObject(decl),
        permissions: extractPermissions(decl)
      }]);
    }
  });

  delegationChains.value = chains;
}

function buildTrustGraph(data: TrustData) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeMap = new Map<string, GraphNode>();
  edgeData.clear();

  // Add the inspected node
  const inspectedNode: GraphNode = {
    id: inspectedPubkey.value,
    trust_level: data.trust_level ?? null,
    trust_tier: data.trust_tier ?? null,
    radius: 24
  };
  nodes.push(inspectedNode);
  nodeMap.set(inspectedPubkey.value, inspectedNode);

  // Add nodes and edges from declarations
  if (data.declarations) {
    data.declarations.forEach((decl) => {
      const issuer = decl.issuing_fingerprint || decl.issuing_keypair_fingerprint || '';
      const subject = decl.target_fingerprint || decl.target_keypair_fingerprint || inspectedPubkey.value;

      if (issuer && !nodeMap.has(issuer)) {
        const node: GraphNode = {
          id: issuer,
          trust_level: null,
          trust_tier: null,
          radius: 18
        };
        nodes.push(node);
        nodeMap.set(issuer, node);
      }

      if (subject && !nodeMap.has(subject)) {
        const node: GraphNode = {
          id: subject,
          trust_level: null,
          trust_tier: null,
          radius: 18
        };
        nodes.push(node);
        nodeMap.set(subject, node);
      }

      if (issuer && subject) {
        const edgeKey = `${issuer}-${subject}`;
        edges.push({ from: issuer, to: subject });
        
        // Store edge metadata
        const trustLevel = extractTrustLevel(decl);
        const scope = extractScopeObject(decl);
        edgeData.set(edgeKey, {
          trust_level: trustLevel || undefined,
          scope
        });
      }
    });
  }

  // Apply layout based on selected mode
  applyLayoutToNodes(nodes);

  trustGraph.nodes = nodes;
  trustGraph.edges = edges;
}

function applyLayoutToNodes(nodes: GraphNode[]) {
  const centerX = graphWidth.value / 2;
  const centerY = graphHeight.value / 2;
  
  if (graphLayoutMode.value === 'circular') {
    const radius = Math.min(graphWidth.value, graphHeight.value) / 3;
    nodes.forEach((node, index) => {
      const angle = (2 * Math.PI * index) / nodes.length;
      node.x = centerX + radius * Math.cos(angle);
      node.y = centerY + radius * Math.sin(angle);
    });
  } else if (graphLayoutMode.value === 'hierarchical') {
    // Hierarchical layout: inspected node at top, others below
    const inspected = nodes.find(n => n.id === inspectedPubkey.value);
    if (inspected) {
      inspected.x = centerX;
      inspected.y = 100;
    }
    
    const others = nodes.filter(n => n.id !== inspectedPubkey.value);
    const cols = Math.ceil(Math.sqrt(others.length));
    const spacing = Math.min(graphWidth.value / (cols + 1), 150);
    const rowHeight = 120;
    
    others.forEach((node, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      node.x = spacing * (col + 1);
      node.y = 250 + row * rowHeight;
    });
  } else {
    // Force-directed: start with circular, will be improved with physics simulation
    const radius = Math.min(graphWidth.value, graphHeight.value) / 3;
    nodes.forEach((node, index) => {
      const angle = (2 * Math.PI * index) / nodes.length;
      node.x = centerX + radius * Math.cos(angle) + (Math.random() - 0.5) * 50;
      node.y = centerY + radius * Math.sin(angle) + (Math.random() - 0.5) * 50;
    });
  }
}

function applyLayout() {
  applyLayoutToNodes(trustGraph.nodes);
}

function getNodeX(nodeId: string): number {
  const node = trustGraph.nodes.find(n => n.id === nodeId);
  if (!node || node.x === undefined) return graphWidth.value / 2;
  return node.x * graphZoom.value + graphPanX.value;
}

function getNodeY(nodeId: string): number {
  const node = trustGraph.nodes.find(n => n.id === nodeId);
  if (!node || node.y === undefined) return graphHeight.value / 2;
  return node.y * graphZoom.value + graphPanY.value;
}

function getNodeColor(node: GraphNode): string {
  if (node.id === inspectedPubkey.value) {
    return '#1976d2'; // Blue for inspected node
  }
  if (selectedNode.value === node.id) {
    return '#f57c00'; // Orange for selected node
  }
  if (node.trust_tier === 'trusted') {
    return '#2e7d32'; // Green for trusted
  }
  if (node.trust_tier === 'verified') {
    return '#1565c0'; // Blue for verified
  }
  return '#757575'; // Gray for others
}

function getNodeData(nodeId: string): GraphNode | undefined {
  return trustGraph.nodes.find(n => n.id === nodeId);
}

function selectNode(nodeId: string) {
  selectedNode.value = nodeId === selectedNode.value ? null : nodeId;
}

function resetGraphView() {
  graphZoom.value = 1;
  graphPanX.value = 0;
  graphPanY.value = 0;
}

function zoomIn() {
  graphZoom.value = Math.min(graphZoom.value * 1.2, 3);
}

function zoomOut() {
  graphZoom.value = Math.max(graphZoom.value / 1.2, 0.5);
}

function handleMouseDown(event: MouseEvent) {
  isDragging.value = true;
  dragStart.value = { x: event.clientX - graphPanX.value, y: event.clientY - graphPanY.value };
}

function handleMouseMove(event: MouseEvent) {
  if (isDragging.value) {
    graphPanX.value = event.clientX - dragStart.value.x;
    graphPanY.value = event.clientY - dragStart.value.y;
  }
  
  // Update tooltip position
  if (tooltipNode.value && graphContainer.value) {
    const rect = graphContainer.value.getBoundingClientRect();
    tooltipX.value = event.clientX - rect.left;
    tooltipY.value = event.clientY - rect.top;
  }
}

function handleMouseUp() {
  isDragging.value = false;
}

function handleWheel(event: WheelEvent) {
  const delta = event.deltaY > 0 ? 0.9 : 1.1;
  const oldZoom = graphZoom.value;
  const newZoom = Math.max(0.5, Math.min(3, graphZoom.value * delta));
  
  if (oldZoom === newZoom) return;
  
  // Adjust pan to zoom towards mouse position
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  
  // Convert mouse position to graph coordinates
  const graphX = (mouseX - graphPanX.value) / oldZoom;
  const graphY = (mouseY - graphPanY.value) / oldZoom;
  
  // Update zoom
  graphZoom.value = newZoom;
  
  // Adjust pan so the point under the mouse stays in place
  graphPanX.value = mouseX - graphX * newZoom;
  graphPanY.value = mouseY - graphY * newZoom;
}

function handleNodeHover(nodeId: string) {
  highlightedNode.value = nodeId;
  const node = trustGraph.nodes.find(n => n.id === nodeId);
  if (node) {
    tooltipNode.value = node;
  }
}

function handleNodeLeave() {
  highlightedNode.value = null;
  tooltipNode.value = null;
}

function handleContextMenu(event: MouseEvent) {
  // Could add context menu for node actions
  event.preventDefault();
}

function getEdgeWidth(edge: GraphEdge): number {
  if (highlightedEdge.value === edge || isEdgeInSelectedPath(edge)) {
    return 4;
  }
  if (highlightedNode.value === edge.from || highlightedNode.value === edge.to) {
    return 3;
  }
  return 2;
}

function getEdgeLabel(edge: GraphEdge): string | null {
  const edgeKey = `${edge.from}-${edge.to}`;
  const data = edgeData.get(edgeKey);
  if (data?.trust_level) {
    return data.trust_level;
  }
  return null;
}

function isEdgeInSelectedPath(edge: GraphEdge): boolean {
  if (selectedPath.value.length < 2) return false;
  for (let i = 0; i < selectedPath.value.length - 1; i++) {
    if (selectedPath.value[i] === edge.from && selectedPath.value[i + 1] === edge.to) {
      return true;
    }
  }
  return false;
}

function getNodeConnectionCount(nodeId: string): number {
  return trustGraph.edges.filter(e => e.from === nodeId || e.to === nodeId).length;
}

function getIncomingCount(nodeId: string): number {
  return trustGraph.edges.filter(e => e.to === nodeId).length;
}

function getOutgoingCount(nodeId: string): number {
  return trustGraph.edges.filter(e => e.from === nodeId).length;
}

function expandNode(nodeId: string) {
  if (expandedNodes.has(nodeId)) {
    expandedNodes.delete(nodeId);
  } else {
    expandedNodes.add(nodeId);
    // Could load additional connections here
  }
}

function expandSelectedNode() {
  if (selectedNode.value) {
    expandNode(selectedNode.value);
  }
}

function inspectNode(nodeId: string) {
  inspectedPubkey.value = nodeId;
  loadTrustGraph();
}

function highlightPath(nodeId: string) {
  // Find shortest path from inspected node to selected node
  const path = findShortestPath(inspectedPubkey.value, nodeId);
  selectedPath.value = path;
}

function findShortestPath(from: string, to: string): string[] {
  if (from === to) return [from];
  
  const visited = new Set<string>();
  const queue: Array<{ node: string; path: string[] }> = [{ node: from, path: [from] }];
  
  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    
    if (node === to) {
      return path;
    }
    
    if (visited.has(node)) continue;
    visited.add(node);
    
    // Find neighbors
    const neighbors = trustGraph.edges
      .filter(e => e.from === node || e.to === node)
      .map(e => e.from === node ? e.to : e.from);
    
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push({ node: neighbor, path: [...path, neighbor] });
      }
    }
  }
  
  return [];
}

function centerGraph() {
  if (trustGraph.nodes.length === 0) return;
  
  // Calculate bounding box
  const xs = trustGraph.nodes.map(n => n.x || 0);
  const ys = trustGraph.nodes.map(n => n.y || 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  
  // Center the graph
  graphPanX.value = graphWidth.value / 2 - centerX * graphZoom.value;
  graphPanY.value = graphHeight.value / 2 - centerY * graphZoom.value;
}

watch(() => showFullScreenGraph.value, (fullscreen) => {
  if (fullscreen) {
    graphWidth.value = window.innerWidth - 100;
    graphHeight.value = window.innerHeight - 200;
  } else {
    graphWidth.value = 800;
    graphHeight.value = 600;
  }
  nextTick(() => {
    applyLayout();
    centerGraph();
  });
});

watch(() => graphLayoutMode.value, () => {
  applyLayout();
  centerGraph();
});

function formatPubkey(pubkey: string | null | undefined): string {
  if (!pubkey) return 'N/A';
  if (pubkey.length > 16) {
    return pubkey.substring(0, 8) + '…' + pubkey.substring(pubkey.length - 8);
  }
  return pubkey;
}

function formatScope(scope: any): string {
  if (!scope || typeof scope !== 'object') {
    return 'Global';
  }
  const type = scope.type || 'global';
  const target = scope.target || '';
  if (type === 'global') {
    return 'Global';
  }
  return `${type}: ${target || '*'}`;
}

function extractTrustLevel(decl: any): string | null {
  try {
    const content = typeof decl.content === 'string' ? JSON.parse(decl.content) : decl.content;
    return content?.trust_level || null;
  } catch {
    return null;
  }
}

function extractScope(decl: any): string | null {
  try {
    const content = typeof decl.content === 'string' ? JSON.parse(decl.content) : decl.content;
    const scope = content?.scopes;
    if (!scope) return null;
    return formatScope(scope);
  } catch {
    return null;
  }
}

function extractScopeObject(decl: any): any {
  try {
    const content = typeof decl.content === 'string' ? JSON.parse(decl.content) : decl.content;
    return content?.scopes || null;
  } catch {
    return null;
  }
}

function extractPermissions(decl: any): Record<string, any> | null {
  try {
    const content = typeof decl.content === 'string' ? JSON.parse(decl.content) : decl.content;
    return content?.permissions || null;
  } catch {
    return null;
  }
}
</script>

<style scoped>
.trust-inspector {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.inspector-header h4 {
  margin: 0 0 8px;
}

.admin-note {
  color: var(--text-secondary, #666);
  font-size: 13px;
  margin: 0 0 16px;
}

.inspector-controls {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
}

.control-group {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.control-group label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.control-group input[type="text"] {
  padding: 6px 8px;
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  font-size: 13px;
  min-width: 300px;
}

.control-group input[type="checkbox"] {
  margin-right: 4px;
}

.error-message {
  padding: 12px;
  background: #ffebee;
  color: #c62828;
  border-radius: 4px;
}

.loading-message {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #666);
}

.inspector-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.overview-section,
.delegation-chains-section,
.trust-graph-section,
.trust-sources-section {
  padding: 16px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
}

.overview-section h5,
.delegation-chains-section h5,
.trust-graph-section h5,
.trust-sources-section h5 {
  margin: 0 0 16px;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.overview-grid label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-bottom: 4px;
}

.trust-value {
  font-weight: 600;
}

.trust-badge {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 16px;
  font-weight: 600;
  font-size: 12px;
  background: var(--bg-primary, white);
  color: var(--text-primary, black);
}

.trust-badge.tier-trusted {
  background: #2e7d32;
  color: #fff;
}

.trust-badge.tier-verified {
  background: #1565c0;
  color: #fff;
}

.delegation-chain {
  margin-bottom: 16px;
  padding: 12px;
  background: white;
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
}

.chain-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}

.chain-length {
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.chain-path {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chain-link {
  padding: 8px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
}

.link-node {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.link-arrow {
  color: var(--text-secondary, #666);
}

.link-details {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.trust-level-badge,
.scope-badge,
.perms-badge {
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 11px;
  background: var(--bg-primary, white);
  border: 1px solid var(--border-color, #ddd);
}

.graph-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.graph-container {
  border: 1px solid var(--border-color, #ddd);
  border-radius: 4px;
  overflow: hidden;
  background: white;
  position: relative;
}

.graph-container.fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  height: 100vh;
  z-index: 1000;
  border-radius: 0;
}

.trust-graph-svg {
  display: block;
  cursor: grab;
}

.trust-graph-svg:active {
  cursor: grabbing;
}

.edge-group {
  cursor: pointer;
}

.edge {
  stroke: #999;
  stroke-width: 2;
  fill: none;
  marker-end: url(#arrowhead);
  transition: stroke-width 0.2s, stroke 0.2s;
}

.edge-group.highlighted .edge {
  stroke: #1976d2;
  stroke-width: 3;
}

.edge-group.selected-path .edge {
  stroke: #f57c00;
  stroke-width: 4;
  stroke-dasharray: 5,5;
}

.edge-label {
  font-size: 10px;
  fill: #666;
  pointer-events: none;
  background: white;
  padding: 2px 4px;
}

.node-glow {
  filter: blur(8px);
  opacity: 0;
  transition: opacity 0.3s;
}

.node-group:hover .node-glow {
  opacity: 0.5;
}

.node {
  fill: #757575;
  stroke: white;
  stroke-width: 2;
  cursor: pointer;
  transition: r 0.2s, stroke-width 0.2s, fill 0.2s;
}

.node-group:hover .node {
  stroke-width: 3;
  r: calc(var(--node-radius, 18) + 2);
}

.node-group.selected .node {
  stroke: #f57c00;
  stroke-width: 4;
  r: calc(var(--node-radius, 18) + 3);
}

.node-group.inspected .node {
  fill: #1976d2;
}

.node-group.expanded .node {
  stroke: #4caf50;
  stroke-width: 3;
}

.node-center {
  pointer-events: none;
}

.node-label-bg {
  fill: rgba(255, 255, 255, 0.9);
  stroke: var(--border-color, #ddd);
  stroke-width: 1;
  pointer-events: none;
}

.node-label {
  font-size: 10px;
  fill: var(--text-primary, black);
  pointer-events: none;
}

.node-trust-level {
  font-size: 9px;
  fill: var(--text-secondary, #666);
  pointer-events: none;
}

.tooltip-group {
  pointer-events: none;
}

.tooltip-bg {
  fill: rgba(0, 0, 0, 0.85);
  stroke: #333;
  stroke-width: 1;
}

.tooltip-title {
  fill: white;
  font-size: 12px;
  font-weight: 600;
}

.tooltip-text {
  fill: #ccc;
  font-size: 11px;
}

.graph-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.graph-section-header h5 {
  margin: 0;
}

.graph-header-controls {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.graph-header-controls label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  cursor: pointer;
}

.graph-header-controls input[type="radio"],
.graph-header-controls input[type="checkbox"] {
  margin: 0;
  cursor: pointer;
}

.graph-legend {
  display: flex;
  gap: 16px;
  padding: 12px;
  background: var(--bg-secondary, #f5f5f5);
  border-radius: 4px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.legend-color {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid white;
}

.legend-color.inspected {
  background: #1976d2;
}

.legend-color.selected {
  background: #f57c00;
}

.legend-color.trusted {
  background: #2e7d32;
}

.legend-color.verified {
  background: #1565c0;
}

.legend-color.default {
  background: #757575;
}

.node-details {
  margin-top: 12px;
  padding: 12px;
  background: white;
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
}

.node-details-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.node-details-header h6 {
  margin: 0;
}

.node-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.btn-link {
  background: none;
  border: none;
  color: var(--color-primary, #1976d2);
  cursor: pointer;
  text-decoration: underline;
  font-size: 12px;
  padding: 0;
}

.btn-link:hover {
  opacity: 0.8;
}

.details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.details-grid label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary, #666);
  margin-bottom: 4px;
}

.sources-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-color, #ddd);
}

.tab-button {
  padding: 8px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary, #666);
}

.tab-button.active {
  color: var(--color-primary, #1976d2);
  border-bottom-color: var(--color-primary, #1976d2);
}

.sources-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.source-item {
  padding: 12px;
  background: white;
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
}

.source-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.status-chip {
  padding: 2px 8px;
  border-radius: 12px;
  background: var(--bg-secondary, #f5f5f5);
  font-size: 11px;
}

.source-details {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary, #666);
}

.mono {
  font-family: monospace;
  font-size: 11px;
}

.btn-primary,
.btn-secondary {
  padding: 8px 16px;
  border-radius: 4px;
  border: 1px solid var(--border-color, #ddd);
  background: var(--bg-primary, white);
  cursor: pointer;
  font-size: 13px;
}

.btn-primary {
  background: var(--color-primary, #1976d2);
  color: white;
  border-color: var(--color-primary, #1976d2);
}

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary:hover:not(:disabled),
.btn-secondary:hover:not(:disabled) {
  opacity: 0.9;
}
</style>

