// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

use anyhow::{Context, Result};
use std::path::PathBuf;

fn output_directory() -> Result<PathBuf> {
    let mut args = std::env::args().skip(1);
    let Some(argument) = args.next() else {
        anyhow::bail!("Usage: tls_material --out <directory>");
    };
    if argument != "--out" {
        anyhow::bail!("Unknown option '{argument}'");
    }
    let directory = args.next().context("--out requires a directory")?;
    if args.next().is_some() {
        anyhow::bail!("Unexpected extra TLS material arguments");
    }
    Ok(PathBuf::from(directory))
}

fn main() -> Result<()> {
    let directory = output_directory()?;
    std::fs::create_dir_all(&directory)
        .with_context(|| format!("Failed to create {}", directory.display()))?;
    let mut params = rcgen::CertificateParams::new(vec!["localhost".to_owned()])
        .context("Failed to create benchmark certificate parameters")?;
    params
        .subject_alt_names
        .push(rcgen::SanType::IpAddress(std::net::IpAddr::V4(
            std::net::Ipv4Addr::LOCALHOST,
        )));
    let key_pair = rcgen::KeyPair::generate().context("Failed to generate benchmark TLS key")?;
    let certificate = params
        .self_signed(&key_pair)
        .context("Failed to generate benchmark TLS certificate")?;
    std::fs::write(directory.join("cert.pem"), certificate.pem())
        .context("Failed to write benchmark TLS certificate")?;
    std::fs::write(directory.join("key.pem"), key_pair.serialize_pem())
        .context("Failed to write benchmark TLS key")?;
    Ok(())
}
