// #[path="src/main.rs"]
// mod main;

fn main() -> std::io::Result<()> {
  println!("Hello from build.rs!");

  let out_dir = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").ok_or_else(|| std::io::ErrorKind::NotFound)?);
  // // let cmd = cli::Cli::command();
  let cmd = clap::Command::new("ylf");

  let man = clap_mangen::Man::new(cmd);
  let mut buffer: Vec<u8> = Default::default();
  man.render(&mut buffer)?;

  std::fs::write(out_dir.join("ylf.1"), buffer)?;

  Ok(())
}
