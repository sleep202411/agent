#!/usr/bin/env bash
set -euo pipefail
CHART="$(cd "$(dirname "$0")/.." && pwd)"
cd "$CHART/../../.."
FIZZDRAGON_CHART="$CHART" node <<'JS'
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const YAML=require('yaml');
const chart=process.env.FIZZDRAGON_CHART;
const base=['--set','azure.enabled=false','--set','server.googleVertex.enabled=false'];
function render(args=[],error){
 const r=spawnSync('helm',['template','fizzdragon',chart,...base,...args],{encoding:'utf8',maxBuffer:10_000_000});
 if(error){assert.notEqual(r.status,0);assert.ok(r.stderr.includes(error),r.stderr);return;}
 assert.equal(r.status,0,r.stderr);
 return YAML.parseAllDocuments(r.stdout).map(d=>d.toJS()).filter(Boolean);
}
const ca=['--set','agentOs.datastore.caConfigMapName=fixture-rds-ca',
 '--set','agentOs.networkPolicy.databaseCidr=10.80.1.23/32',
 '--set','agentOs.networkPolicy.clusterCidrs={10.80.0.0/16,10.81.0.0/16,10.82.0.0/20}'];
const objects=render(ca);
const pod=objects.find(r=>r.kind==='Deployment'&&r.metadata.name==='fizzdragon-agent-os').spec.template.spec;
assert.equal(pod.automountServiceAccountToken,false);
assert.equal(pod.serviceAccountName,undefined);
assert.deepEqual(pod.volumes.find(v=>v.name==='datastore-ca').configMap,{name:'fixture-rds-ca',optional:false});
assert.deepEqual(pod.containers[0].volumeMounts.find(m=>m.name==='datastore-ca'),
 {name:'datastore-ca',mountPath:'/etc/fizzdragon/certs',readOnly:true});
assert.deepEqual(pod.containers[0].envFrom,[{secretRef:{name:'fizzdragon-agent-os-secrets'}}]);
const scoped=render([...ca,'--set','agentOs.datastore.databaseSecret.name=fixture-snapshot-db']);
assert.deepEqual(scoped.find(r=>r.kind==='Deployment'&&r.metadata.name==='fizzdragon-agent-os')
 .spec.template.spec.containers[0].env.find(e=>e.name==='AGENT_OS_CHECKPOINT_DATABASE_URL').valueFrom,
 {secretKeyRef:{name:'fixture-snapshot-db',key:'AGENT_OS_CHECKPOINT_DATABASE_URL',optional:false}},
 'The explicitly selected snapshot must override the inherited canonical database DSN');
render([...ca,'--set','agentOs.datastore.databaseSecret.name=fixture-snapshot-db',
 '--set-string','agentOs.datastore.databaseSecret.key='],'databaseSecret.key is required');
const policy=objects.find(r=>r.kind==='NetworkPolicy'&&r.metadata.name==='fizzdragon-agent-os-egress').spec;
const db=policy.egress.find(e=>e.to?.[0]?.ipBlock?.cidr==='10.80.1.23/32');
assert.deepEqual(db.ports,[{protocol:'TCP',port:5432}]);
const external=policy.egress.find(e=>e.to?.[0]?.ipBlock?.cidr==='0.0.0.0/0');
assert.deepEqual(external.ports,[{protocol:'TCP',port:443}]);
assert.ok(external.to[0].ipBlock.except.includes('10.80.0.0/16'));
const baseline=render();
assert.ok(!baseline.find(r=>r.kind==='Deployment'&&r.metadata.name==='fizzdragon-agent-os')
 .spec.template.spec.volumes.some(v=>v.name==='datastore-ca'));
assert.ok(baseline.find(r=>r.kind==='NetworkPolicy'&&r.metadata.name==='fizzdragon-agent-os-egress')
 .spec.egress.at(-1).ports.some(p=>p.port===5432),'Existing public-database egress is preserved');
const sg=render(['-f',`${chart}/values.sg-agent-os.yaml`]);
const sgPod=sg.find(r=>r.kind==='Deployment'&&r.metadata.name==='fizzdragon-agent-os').spec.template.spec;
assert.equal(sgPod.volumes.find(v=>v.name==='datastore-ca').configMap.name,'fizzdragon-datastore-ca');
assert.equal(sgPod.nodeSelector,undefined,'Azure node selectors must not reach ACK');
const sgEgress=sg.find(r=>r.kind==='NetworkPolicy'&&r.metadata.name==='fizzdragon-agent-os-egress').spec.egress;
assert.ok(sgEgress.some(e=>e.to?.[0]?.ipBlock?.cidr==='10.80.0.107/32'));
const paused=render(['-f',`${chart}/values.background-tasks-paused.yaml`,'-f',`${chart}/values.sg-agent-os.yaml`]);
assert.ok(!paused.some(r=>r.kind==='Deployment'&&r.metadata.name==='fizzdragon-agent-os'),
 'The Singapore configuration layer must preserve the explicit worker pause');
for(const path of ['', 'relative/path'])render([...ca,'--set-string',`agentOs.datastore.caMountPath=${path}`],
 path?'must be an absolute path':'caMountPath is required');
for(const cidr of ['0.0.0.0/0','10.80.0.0/16','10.999.1.2/32','169.254.169.254/32','127.0.0.1/32']){
 render([...ca,'--set-string',`agentOs.networkPolicy.databaseCidr=${cidr}`],
 cidr.startsWith('169.254.')||cidr.startsWith('127.')?'must not allow metadata or loopback':'requires an exact IPv4 /32');
}
render([...ca,'--set','agentOs.networkPolicy.databasePort=0'],'requires an exact IPv4 /32');
console.log('Agent OS datastore render checks passed: scoped CA and Secret, exact private RDS egress, no API token, required paths and rejected broad/invalid destinations.');
JS
