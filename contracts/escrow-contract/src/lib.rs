#![no_std]

//! Escrow with dispute resolution and expiry: a client locks funds with
//! `create_job`, then either `release_escrow` sends them to the freelancer,
//! or either party can `dispute` a stalled job for the admin to resolve via
//! `resolve_dispute`. If a job's `expiry_ledger` passes with no release or
//! dispute, the client can reclaim funds with `cancel_job`.

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, token, Address, Env, String};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum JobStatus {
    Escrowed,
    Released,
    Disputed,
    Refunded,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Job {
    pub id: String,
    pub client: Address,
    pub freelancer: Address,
    pub token: Address,
    pub amount: i128,
    pub status: JobStatus,
    pub expiry_ledger: u32,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Job(String),
}

#[contract]
pub struct EscrowContract;

#[contractimpl]
impl EscrowContract {
    /// One-time setup: designates the admin address that resolves disputes.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Client funds escrow: transfers `amount` of `token` from client into this
    /// contract, then records the job. `expiry_ledger` must be a future ledger
    /// sequence — once it passes without release or dispute, the client can
    /// reclaim funds via `cancel_job`.
    pub fn create_job(
        env: Env,
        client: Address,
        freelancer: Address,
        job_id: String,
        token: Address,
        amount: i128,
        expiry_ledger: u32,
    ) {
        client.require_auth();
        if amount <= 0 {
            panic!("Amount must be positive");
        }
        if expiry_ledger <= env.ledger().sequence() {
            panic!("Expiry must be in the future");
        }
        if env.storage().instance().has(&DataKey::Job(job_id.clone())) {
            panic!("Job already exists");
        }

        let token_client = token::Client::new(&env, &token);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&client, &contract_addr, &amount);

        let job = Job {
            id: job_id.clone(),
            client: client.clone(),
            freelancer,
            token: token.clone(),
            amount,
            status: JobStatus::Escrowed,
            expiry_ledger,
        };
        env.storage().instance().set(&DataKey::Job(job_id), &job);
    }

    /// Client authorizes release; contract transfers locked funds to the freelancer.
    pub fn release_escrow(env: Env, client: Address, job_id: String) {
        client.require_auth();
        let mut job: Job = env
            .storage()
            .instance()
            .get(&DataKey::Job(job_id.clone()))
            .expect("Job not found");
        if job.client != client {
            panic!("Only the client can release");
        }
        if job.status != JobStatus::Escrowed {
            panic!("Job is not in escrow");
        }

        let token_client = token::Client::new(&env, &job.token);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&contract_addr, &job.freelancer, &job.amount);

        job.status = JobStatus::Released;
        env.storage().instance().set(&DataKey::Job(job_id), &job);
    }

    /// Either the client or the freelancer can flag a stalled job as disputed,
    /// freezing it until the admin resolves it.
    pub fn dispute(env: Env, caller: Address, job_id: String) {
        caller.require_auth();
        let mut job: Job = env
            .storage()
            .instance()
            .get(&DataKey::Job(job_id.clone()))
            .expect("Job not found");
        if caller != job.client && caller != job.freelancer {
            panic!("Only the client or freelancer can dispute this job");
        }
        if job.status != JobStatus::Escrowed {
            panic!("Job is not in escrow");
        }

        job.status = JobStatus::Disputed;
        env.storage().instance().set(&DataKey::Job(job_id.clone()), &job);
        env.events().publish((symbol_short!("disputed"), caller), job_id);
    }

    /// Admin resolves a disputed job: releases to the freelancer or refunds the client.
    pub fn resolve_dispute(env: Env, admin: Address, job_id: String, release_to_freelancer: bool) {
        admin.require_auth();
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        if stored_admin != admin {
            panic!("Only admin can resolve disputes");
        }

        let mut job: Job = env
            .storage()
            .instance()
            .get(&DataKey::Job(job_id.clone()))
            .expect("Job not found");
        if job.status != JobStatus::Disputed {
            panic!("Job is not disputed");
        }

        let token_client = token::Client::new(&env, &job.token);
        let contract_addr = env.current_contract_address();
        if release_to_freelancer {
            token_client.transfer(&contract_addr, &job.freelancer, &job.amount);
            job.status = JobStatus::Released;
        } else {
            token_client.transfer(&contract_addr, &job.client, &job.amount);
            job.status = JobStatus::Refunded;
        }
        env.storage().instance().set(&DataKey::Job(job_id.clone()), &job);
        env.events()
            .publish((symbol_short!("resolved"), admin), (job_id, release_to_freelancer));
    }

    /// Client reclaims funds once the job's expiry ledger has passed without
    /// a release or a dispute being raised.
    pub fn cancel_job(env: Env, client: Address, job_id: String) {
        client.require_auth();
        let mut job: Job = env
            .storage()
            .instance()
            .get(&DataKey::Job(job_id.clone()))
            .expect("Job not found");
        if job.client != client {
            panic!("Only the client can cancel this job");
        }
        if job.status != JobStatus::Escrowed {
            panic!("Job is not in escrow");
        }
        if env.ledger().sequence() <= job.expiry_ledger {
            panic!("Job has not expired yet");
        }

        let token_client = token::Client::new(&env, &job.token);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&contract_addr, &job.client, &job.amount);

        job.status = JobStatus::Refunded;
        env.storage().instance().set(&DataKey::Job(job_id), &job);
    }

    pub fn get_job(env: Env, job_id: String) -> Option<Job> {
        env.storage().instance().get(&DataKey::Job(job_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::token::StellarAssetClient;
    use soroban_sdk::{Address, Env, String};

    const EXPIRY_WINDOW: u32 = 1000;

    /// Sets up a contract, a funded token, and one escrowed job. Returns
    /// everything a test needs to drive it further.
    fn setup() -> (
        Env,
        EscrowContractClient<'static>,
        Address, // admin
        Address, // client
        Address, // freelancer
        Address, // token
        String,  // job_id
        i128,    // amount
        u32,     // expiry_ledger
    ) {
        let env = Env::default();
        env.mock_all_auths();

        let cid = env.register_contract(None, EscrowContract);
        let client_handle = EscrowContractClient::new(&env, &cid);

        let admin = Address::generate(&env);
        client_handle.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        let token_client = StellarAssetClient::new(&env, &token);

        let amount = 100_i128;
        token_client.mint(&client, &amount);

        let job_id = String::from_str(&env, "job-1");
        let expiry_ledger = env.ledger().sequence() + EXPIRY_WINDOW;
        client_handle.create_job(&client, &freelancer, &job_id, &token, &amount, &expiry_ledger);

        (env, client_handle, admin, client, freelancer, token, job_id, amount, expiry_ledger)
    }

    #[test]
    #[should_panic(expected = "Job not found")]
    fn release_missing_job_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register_contract(None, EscrowContract);
        let client = EscrowContractClient::new(&env, &cid);
        let addr = Address::generate(&env);
        client.release_escrow(&addr, &String::from_str(&env, "no-such-job"));
    }

    #[test]
    #[should_panic(expected = "Expiry must be in the future")]
    fn create_job_rejects_past_expiry() {
        let env = Env::default();
        env.mock_all_auths();
        let cid = env.register_contract(None, EscrowContract);
        let contract = EscrowContractClient::new(&env, &cid);
        let admin = Address::generate(&env);
        contract.initialize(&admin);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(token_admin).address();
        StellarAssetClient::new(&env, &token).mint(&client, &100);

        let current = env.ledger().sequence();
        contract.create_job(
            &client,
            &freelancer,
            &String::from_str(&env, "job-bad-expiry"),
            &token,
            &100,
            &current,
        );
    }

    #[test]
    fn dispute_by_client_moves_job_to_disputed() {
        let (_env, contract, _admin, client, _freelancer, _token, job_id, _amount, _expiry) = setup();

        contract.dispute(&client, &job_id);

        let job = contract.get_job(&job_id).unwrap();
        assert_eq!(job.status, JobStatus::Disputed);
    }

    #[test]
    fn dispute_by_freelancer_moves_job_to_disputed() {
        let (_env, contract, _admin, _client, freelancer, _token, job_id, _amount, _expiry) = setup();

        contract.dispute(&freelancer, &job_id);

        let job = contract.get_job(&job_id).unwrap();
        assert_eq!(job.status, JobStatus::Disputed);
    }

    #[test]
    #[should_panic(expected = "Only the client or freelancer can dispute this job")]
    fn dispute_by_unrelated_address_panics() {
        let (env, contract, _admin, _client, _freelancer, _token, job_id, _amount, _expiry) = setup();
        let stranger = Address::generate(&env);
        contract.dispute(&stranger, &job_id);
    }

    #[test]
    fn admin_resolves_dispute_in_favour_of_freelancer() {
        let (env, contract, admin, _client, freelancer, token, job_id, amount, _expiry) = setup();
        contract.dispute(&freelancer, &job_id);

        contract.resolve_dispute(&admin, &job_id, &true);

        let job = contract.get_job(&job_id).unwrap();
        assert_eq!(job.status, JobStatus::Released);
        let token_client = token::Client::new(&env, &token);
        assert_eq!(token_client.balance(&freelancer), amount);
    }

    #[test]
    fn admin_resolves_dispute_in_favour_of_client() {
        let (env, contract, admin, client, _freelancer, token, job_id, amount, _expiry) = setup();
        contract.dispute(&client, &job_id);

        contract.resolve_dispute(&admin, &job_id, &false);

        let job = contract.get_job(&job_id).unwrap();
        assert_eq!(job.status, JobStatus::Refunded);
        let token_client = token::Client::new(&env, &token);
        assert_eq!(token_client.balance(&client), amount);
    }

    #[test]
    #[should_panic(expected = "Only admin can resolve disputes")]
    fn resolve_dispute_by_non_admin_panics() {
        let (env, contract, _admin, client, _freelancer, _token, job_id, _amount, _expiry) = setup();
        contract.dispute(&client, &job_id);
        let impostor = Address::generate(&env);
        contract.resolve_dispute(&impostor, &job_id, &true);
    }

    #[test]
    fn cancel_after_expiry_refunds_client() {
        let (env, contract, _admin, client, _freelancer, token, job_id, amount, expiry_ledger) = setup();
        env.ledger().set_sequence_number(expiry_ledger + 1);

        contract.cancel_job(&client, &job_id);

        let job = contract.get_job(&job_id).unwrap();
        assert_eq!(job.status, JobStatus::Refunded);
        let token_client = token::Client::new(&env, &token);
        assert_eq!(token_client.balance(&client), amount);
    }

    #[test]
    #[should_panic(expected = "Job has not expired yet")]
    fn cancel_before_expiry_fails() {
        let (_env, contract, _admin, client, _freelancer, _token, job_id, _amount, _expiry) = setup();
        contract.cancel_job(&client, &job_id);
    }

    #[test]
    #[should_panic(expected = "Only the client can cancel this job")]
    fn cancel_by_non_client_panics() {
        let (env, contract, _admin, _client, freelancer, _token, job_id, _amount, expiry_ledger) = setup();
        env.ledger().set_sequence_number(expiry_ledger + 1);
        contract.cancel_job(&freelancer, &job_id);
    }
}
