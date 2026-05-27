typescript
function validateArtifact(artifact, context) {
    const report = new ValidationReport();
    
    // 1. Root Check
    if (!artifact.title || !artifact.summary) report.addError("Missing root metadata");
    
    // 2. Node Singularity & Integrity
    const rootNodes = artifact.nodes.filter(n => !n.parentId);
    if (rootNodes.length !== 1) report.addError("Exactly one root node required");
    
    // 3. Recursive Property Check
    artifact.nodes.forEach(node => {
        if (!ACCEPTED_TYPES.includes(node.type)) report.addError(`Invalid type: ${node.type}`);
        if (node.priority < 1 || node.priority > 5) report.addError("Priority out of bounds");
        // ... more checks
    });

    // 4. Evidence Preservation
    const evidence = preserveLiveCallback(context);
    
    return {
        isValid: !report.hasErrors(),
        report: report.toJSON(),
        evidence: evidence
    };
}