import styles from "./loading.module.css";

export default function FacilityZonesLoading() {
  return (
    <p className={styles.loading} role="status">
      Loading zones…
    </p>
  );
}
