# Smart Contract Deployment Checklist

Use this checklist before deploying to mainnet.

## Pre-Deployment Review

### Code Quality
- [ ] All PR checks pass (formatting, linting, tests)
- [ ] Code reviewed and approved (2+ reviewers)
- [ ] No merge conflicts
- [ ] Changelog updated with new features/fixes
- [ ] Version bumped appropriately (semver)

### Testing
- [ ] `cargo test --lib` passes (unit tests)
- [ ] `cargo test --test '*'` passes (integration tests)
- [ ] `cargo test test_upgrade_*` passes (upgrade regression tests)
- [ ] Security audit passes (`cargo audit`)
- [ ] Code coverage meets minimum (80%+ for core logic)
- [ ] Manual testing completed on testnet
- [ ] All edge cases tested

### Documentation
- [ ] Code comments explain non-obvious logic
- [ ] README updated if APIs changed
- [ ] UPGRADE.md updated with migration notes (if needed)
- [ ] SECURITY.md reviewed for new vulnerabilities
- [ ] Function signatures documented

### Testnet Validation

- [ ] Deployed to testnet successfully
- [ ] Deployment manifests generated and reviewed
- [ ] WASM checksums verified
- [ ] Contract initializes correctly
- [ ] All functions callable and return expected values
- [ ] Storage is persisted correctly
- [ ] Performance is acceptable (gas costs)
- [ ] No error logs or warnings
- [ ] Monitoring configured and receiving data

### Storage & Migration
- [ ] Storage keys documented
- [ ] Storage compatibility verified
- [ ] Upgrade regression test passes
- [ ] Old data accessible after upgrade (if applicable)
- [ ] Migration path documented (if needed)
- [ ] Rollback procedure documented

### Security Review
- [ ] No hardcoded secrets or credentials
- [ ] Input validation present for all functions
- [ ] Authorization checks in place for admin functions
- [ ] No integer overflow/underflow vulnerabilities
- [ ] Reentrancy protection if needed
- [ ] No unsafe code blocks (or justified with comments)
- [ ] Dependency vulnerabilities resolved
- [ ] Security audit completed and reviewed

### Governance Preparation

- [ ] Proposal JSON generated (`upgrade-[contract]-*.json`)
- [ ] Proposal reviewed for accuracy
- [ ] Git metadata (SHA, author) correct
- [ ] WASM hash matches local build
- [ ] DAO contract address configured
- [ ] Voting period duration appropriate
- [ ] Execution delay acceptable

## Deployment Steps

### Step 1: Final Build & Test
```bash
cd contracts
cargo clean
cargo build --workspace --target wasm32-unknown-unknown --release
cargo test --workspace
cargo audit
```
- [ ] Build succeeds
- [ ] All tests pass
- [ ] No security vulnerabilities

### Step 2: Generate Deployment Artifacts
```bash
STELLAR_CONTRACT_ID=$OLD_CONTRACT_ID \
./scripts/deploy-contracts-automated.sh mainnet propose greenpay-contract
```
- [ ] Proposal JSON created
- [ ] Checksums verified
- [ ] Git metadata embedded

### Step 3: Submit to DAO
```bash
# Proposal JSON location: .deployments/proposals/upgrade-[contract]-*.json
cat .deployments/proposals/upgrade-*.json | jq .
```
- [ ] Proposal reviewed
- [ ] Submitted to DAO governance contract
- [ ] Voting period started
- [ ] DAO members notified

### Step 4: Monitor Voting Period
- [ ] Voting is active
- [ ] Voting power calculated correctly
- [ ] No technical issues with voting
- [ ] Community discussion completed

### Step 5: Execution (If Approved)
```bash
stellar contract invoke \
  --id $DAO_GOVERNANCE_CONTRACT_ID \
  --source executor \
  --network mainnet \
  -- execute_proposal \
  --proposal_id proposal_uuid
```
- [ ] Vote threshold met
- [ ] Proposal approved
- [ ] Execution delay passed
- [ ] Transaction successful

### Step 6: Post-Execution Verification
```bash
STELLAR_CONTRACT_ID=$CONTRACT_ID \
./scripts/verify-contract.sh mainnet $CONTRACT_ID greenpay-contract
```
- [ ] Contract deployed successfully
- [ ] WASM hash matches proposal
- [ ] Contract responds to queries
- [ ] Storage accessible
- [ ] Monitoring shows normal operation
- [ ] No error logs

## Rollback Preparation

- [ ] Previous contract version archived
- [ ] Rollback procedures documented
- [ ] Previous WASM hash saved
- [ ] Rollback proposal template prepared
- [ ] Team notified of rollback procedure

## Monitoring & Observability

Post-Deployment:

- [ ] Dashboard configured
- [ ] Alerts set up for:
  - Error rates > threshold
  - High gas costs
  - Function failures
  - Storage issues
- [ ] Logs being aggregated
- [ ] Metrics being collected
- [ ] On-call rotation updated

## Communication

Before Deployment:

- [ ] Team notified of deployment plan
- [ ] Deployment window scheduled
- [ ] Customer success notified
- [ ] Support team briefed on changes
- [ ] Known issues documented

After Deployment:

- [ ] Announcement sent (if user-facing)
- [ ] Deployment summary published
- [ ] Status page updated
- [ ] Stakeholders notified
- [ ] Lessons learned documented

## Contingency

If Deployment Fails:

1. [ ] Identify root cause
2. [ ] Notify stakeholders
3. [ ] Prepare rollback proposal
4. [ ] Execute rollback if needed
5. [ ] Investigate and fix issue
6. [ ] Plan retry deployment

## Sign-Off

- [ ] Tech Lead reviewed checklist
- [ ] Product Lead approved deployment
- [ ] Security Team signed off
- [ ] DevOps confirmed readiness

**Reviewed by**: ________________  
**Date**: ________________  
**Approval**: ________________  

---

## Notes

Use this section to document any exceptions or special considerations:

```
[Notes go here]
```

## Additional Resources

- [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Full deployment guide
- [QUICKSTART_DEPLOYMENT.md](QUICKSTART_DEPLOYMENT.md) - Quick reference
- [contracts/TESTING_STRATEGY.md](contracts/TESTING_STRATEGY.md) - Testing guide
- [contracts/greenpay-contract/UPGRADE.md](contracts/greenpay-contract/UPGRADE.md) - Storage compatibility
- [contracts/greenpay-contract/SECURITY.md](contracts/greenpay-contract/SECURITY.md) - Security considerations

---

**Last Updated**: 2024-06-22
**Version**: 1.0
