import { listarAcoes, obterManual } from '@/modules/rel';
import { exigirPagina } from '@/shared/authz';

// Manual do usuário e roteiro de treinamento (US-118): o do perfil de quem lê, montado do catálogo
// de funcionalidades, sempre igual ao sistema no ar.
export default async function Manual() {
  const ctx = await exigirPagina('aut.tela_principal', 'consultar');
  const { manual, roteiro } = await obterManual(ctx);
  return (
    <div>
      <h1>Manual do usuário</h1>
      <p>
        Este manual mostra só o que o seu perfil de acesso permite, na ordem do menu. Ele acompanha o sistema: quando uma funcionalidade muda
        ou é liberada para você, o manual muda junto. Em cada tela, o botão Ajuda da barra de status traz o mesmo texto.
      </p>
      {manual.length === 0 ? (
        <p>Nenhuma funcionalidade disponível para o seu perfil de acesso. Contate o Administrador.</p>
      ) : (
        <>
          <nav aria-label="Sumário do manual">
            <ol>
              {manual.map((m) => (
                <li key={m.nome}>
                  <a href={`#modulo-${encodeURIComponent(m.nome)}`}>{m.nome}</a>
                </li>
              ))}
              <li>
                <a href="#roteiro">Roteiro de treinamento</a>
              </li>
            </ol>
          </nav>
          {manual.map((m) => (
            <section key={m.nome} id={`modulo-${encodeURIComponent(m.nome)}`} aria-labelledby={`titulo-${encodeURIComponent(m.nome)}`}>
              <h2 id={`titulo-${encodeURIComponent(m.nome)}`}>{m.nome}</h2>
              {m.grupos.map((g) => (
                <div key={g.nome}>
                  <h3>{g.nome}</h3>
                  {g.funcionalidades.map((f) => (
                    <article key={f.codigo} aria-label={f.nome}>
                      <h4>
                        <a href={f.rota}>{f.nome}</a>
                      </h4>
                      <p>{f.ajuda ?? 'Conteúdo de ajuda não disponível para esta funcionalidade.'}</p>
                      <p>Você pode: {listarAcoes(f.acoes)}.</p>
                    </article>
                  ))}
                </div>
              ))}
            </section>
          ))}
          <section id="roteiro" aria-labelledby="titulo-roteiro">
            <h2 id="titulo-roteiro">Roteiro de treinamento</h2>
            <p>
              Faça os passos na ordem, no ambiente de homologação, com dados de teste. Cada passo abre uma funcionalidade e tem um exercício por
              ação que o seu perfil permite.
            </p>
            <ol>
              {roteiro.map((p) => (
                <li key={p.rota}>
                  <a href={p.rota}>{p.funcionalidade}</a> ({p.local})
                  <ul>
                    {p.exercicios.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
