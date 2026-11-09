// Un ampersand con forma convencional.
//
// La tipografia de la aplicacion es Archivo, y su "&" tiene un dibujo poco
// habitual que llama la atencion mas que la palabra que une. Como no se puede
// cambiar la fuente del resto del texto solo por un caracter, se pinta ese
// caracter con una pila de grotescas clasicas, que es donde el ampersand tiene la
// forma que todo el mundo reconoce.
//
// Solo cambia la familia: tamaño, peso y color los hereda, asi que encaja dentro
// de cualquier linea sin desalinearla.

export function Ampersand() {
  return (
    <span
      style={{
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      }}
    >
      &amp;
    </span>
  );
}
